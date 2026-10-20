/**
 * Apertura de la base.
 *
 * Un solo archivo SQLite en el celular. No hay servidor y no hay otra copia, así que el
 * respaldo no es opcional — ver `respaldo.ts`.
 *
 * Orden de las cosas al abrir, y no es casual:
 *
 * 1. `journal_mode = WAL` y `foreign_keys = ON`. Los dos van **fuera de toda transacción**:
 *    cambiar el modo de journal dentro de una falla, y `foreign_keys` es un no-op dentro de
 *    una transacción.
 * 2. Migraciones pendientes, cada una en su transacción.
 * 3. Recién entonces la app puede leer o escribir.
 */

import * as SQLite from 'expo-sqlite';

import { migrar, versionDeLaBase, versionObjetivo, type ResultadoMigracion } from './migrador';
import { tomarRespaldo, type Respaldo } from './respaldo';

export const NOMBRE_BASE = 'prestamista.db';

export type BaseAbierta = {
  readonly db: SQLite.SQLiteDatabase;
  readonly migracion: ResultadoMigracion;
  /** El respaldo que se tomó antes de migrar, si hubo migraciones pendientes. */
  readonly respaldoPrevio: Respaldo | null;
};

export async function abrirBase(nombre: string = NOMBRE_BASE): Promise<BaseAbierta> {
  const db = await SQLite.openDatabaseAsync(nombre);

  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // Antes de migrar, un respaldo. Una migración puede reconstruir tablas, y si algo sale mal
  // a mitad de camino la cartera es lo único que no se puede volver a cargar a mano. Solo
  // cuando ya hay una base armada: en una instalación nueva no hay nada que proteger.
  const version = await versionDeLaBase(db);
  let respaldoPrevio: Respaldo | null = null;

  if (version > 0 && version < versionObjetivo()) {
    try {
      respaldoPrevio = await tomarRespaldo(db, {
        etiqueta: `antes-de-migrar-v${versionObjetivo()}`,
      });
    } catch {
      // Si el respaldo falla (sin espacio, permisos), la migración sigue igual: quedarse en
      // una versión vieja del esquema dejaría la app sin arrancar, que es peor.
    }
  }

  const migracion = await migrar(db);
  return { db, migracion, respaldoPrevio };
}

/**
 * Envoltorio para una operación de negocio que escribe varias filas.
 *
 * Usa `withTransactionAsync` y no la exclusiva **a propósito**. La exclusiva abre una
 * conexión nueva, y eso trae dos problemas: pide un `BEGIN EXCLUSIVE` que con el WAL activo
 * en la conexión principal puede quedarse esperando un candado para siempre —la app se
 * cuelga sin dar error—, y además deja las claves foráneas apagadas, que en un cobro o un
 * desembolso son parte de lo que protege los datos. La app es de un solo usuario y hace una
 * operación a la vez, así que la exclusividad no compra nada.
 *
 * Todo lo que escribe más de una fila pasa por acá. Un cobro que insertó el pago pero no sus
 * imputaciones deja la cartera inconsistente, y en un celular la app se puede cerrar en
 * cualquier momento: batería, una llamada entrante, el sistema matándola en segundo plano.
 */
export async function enTransaccion<T>(
  db: SQLite.SQLiteDatabase,
  operacion: () => Promise<T>,
): Promise<T> {
  let resultado!: T;
  await db.withTransactionAsync(async () => {
    resultado = await operacion();
  });
  return resultado;
}
