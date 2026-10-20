/**
 * Corredor de migraciones.
 *
 * No hay Alembic en un celular, así que esto es código propio y de la primera semana. Las
 * migraciones son una lista numerada, **solo hacia adelante**, y se aplican al abrir la app,
 * **cada una en su transacción**: si una falla, no deja la base a mitad de camino.
 *
 * `PRAGMA user_version` guarda la versión aplicada. Jamás "borrar y recrear" el esquema: ahí
 * vive la cartera, y es la diferencia entre un proyecto de juguete y uno con los datos de
 * alguien adentro.
 *
 * **Todo corre sobre una sola conexión**, con `withTransactionAsync`.
 * `withExclusiveTransactionAsync` parecía la opción correcta porque garantiza el orden, pero
 * abre una **segunda conexión** y pide un `BEGIN EXCLUSIVE`: con el WAL activo en la conexión
 * principal se queda esperando un candado que no llega, y la app se cuelga al arrancar sin
 * dar ningún error. Encima, dentro de una transacción exclusiva las claves foráneas quedan
 * apagadas, porque `PRAGMA foreign_keys` es por conexión y es un no-op dentro de una
 * transacción. Una sola conexión evita las dos cosas.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import type { EjecutorSQL } from './ejecutor';
import { migracion001 } from './migraciones/001-inicial';
import { migracion002 } from './migraciones/002-obligacion-refinanciada';

export type { EjecutorSQL };

export type Migracion = {
  readonly version: number;
  readonly nombre: string;
  readonly aplicar: (db: EjecutorSQL) => Promise<void>;
  /**
   * Reconstruye una tabla (crear la nueva, copiar, borrar la vieja, renombrar).
   *
   * SQLite no sabe cambiar un `CHECK` ni quitar una columna con `ALTER TABLE`, así que el
   * único camino es rehacer la tabla — y para eso **las claves foráneas tienen que estar
   * apagadas**, o el `DROP` de la tabla vieja rompe las que la referencian.
   *
   * El procedimiento es el que recomienda la documentación de SQLite: apagar las claves
   * fuera de la transacción, hacer el trabajo adentro (así sigue siendo todo o nada),
   * comprobar que no quedaron referencias huérfanas, y volver a encenderlas.
   */
  readonly reconstruyeTablas?: boolean;
};

/**
 * Las migraciones, en orden. Para agregar una: archivo nuevo en `migraciones/`, versión
 * siguiente, y se suma acá al final. Nunca se edita una que ya salió a un celular.
 *
 * Una migración que **mueve datos** (no solo estructura) trae su lógica escrita y no deja
 * filas huérfanas, y antes de aplicarla se toma un respaldo automático.
 */
export const MIGRACIONES: readonly Migracion[] = [migracion001, migracion002];

export type ResultadoMigracion = {
  readonly versionAnterior: number;
  readonly versionActual: number;
  readonly aplicadas: readonly string[];
};

export class MigracionInvalidaError extends Error {}

function validarLista(migraciones: readonly Migracion[]): void {
  const vistas = new Set<number>();
  let anterior = 0;

  for (const migracion of migraciones) {
    if (!Number.isSafeInteger(migracion.version) || migracion.version < 1) {
      throw new MigracionInvalidaError(
        `La migración "${migracion.nombre}" tiene una versión inválida: ${migracion.version}.`,
      );
    }
    if (vistas.has(migracion.version)) {
      throw new MigracionInvalidaError(`Hay dos migraciones con la versión ${migracion.version}.`);
    }
    if (migracion.version <= anterior) {
      throw new MigracionInvalidaError(
        `Las migraciones deben estar en orden creciente: ${migracion.nombre} ` +
          `(versión ${migracion.version}) viene después de la versión ${anterior}.`,
      );
    }
    vistas.add(migracion.version);
    anterior = migracion.version;
  }
}

export async function versionDeLaBase(db: EjecutorSQL): Promise<number> {
  const fila = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return fila?.user_version ?? 0;
}

/** La versión a la que debería llegar la base con el código actual. */
export function versionObjetivo(migraciones: readonly Migracion[] = MIGRACIONES): number {
  return migraciones.reduce((maxima, m) => Math.max(maxima, m.version), 0);
}

export class ReferenciasHuerfanasError extends Error {}

/**
 * Aplica una migración.
 *
 * `withTransactionAsync` y no la exclusiva: la exclusiva abre una **segunda conexión** y pide
 * un BEGIN EXCLUSIVE, que con el WAL ya activo en la conexión principal puede quedarse
 * esperando un candado para siempre — un bloqueo mutuo sin error, con la app colgada al
 * arrancar. Con una sola conexión eso no puede pasar, y las claves foráneas siguen activas.
 */
async function aplicarUna(db: SQLiteDatabase, migracion: Migracion): Promise<void> {
  const hacerElTrabajo = async () => {
    await db.withTransactionAsync(async () => {
      await migracion.aplicar(db);
      // `version` es una constante del código, nunca entrada del usuario, y está validada
      // como entero: PRAGMA no admite parámetros, así que la interpolación es la única vía.
      await db.execAsync(`PRAGMA user_version = ${migracion.version}`);
    });
  };

  if (!migracion.reconstruyeTablas) {
    await hacerElTrabajo();
    return;
  }

  // Fuera de la transacción: `PRAGMA foreign_keys` es un no-op adentro.
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await hacerElTrabajo();

    const huerfanas = await db.getAllAsync<Record<string, unknown>>('PRAGMA foreign_key_check');
    if (huerfanas.length > 0) {
      throw new ReferenciasHuerfanasError(
        `La migración "${migracion.nombre}" dejó ${huerfanas.length} referencias huérfanas. ` +
          'La base quedó con las claves foráneas rotas; restaurá el respaldo previo.',
      );
    }
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}

export async function migrar(
  db: SQLiteDatabase,
  migraciones: readonly Migracion[] = MIGRACIONES,
): Promise<ResultadoMigracion> {
  validarLista(migraciones);

  const versionAnterior = await versionDeLaBase(db);
  const pendientes = migraciones.filter((m) => m.version > versionAnterior);
  const aplicadas: string[] = [];

  for (const migracion of pendientes) {
    await aplicarUna(db, migracion);
    aplicadas.push(`${migracion.version}-${migracion.nombre}`);
  }

  return {
    versionAnterior,
    versionActual: await versionDeLaBase(db),
    aplicadas,
  };
}
