/**
 * Restauración de un respaldo, en SQL puro.
 *
 * No reemplaza el archivo de la base. Abre el respaldo como base en memoria y **copia su
 * contenido** tabla por tabla sobre la base viva. Tres razones, y las tres importan:
 *
 * 1. **Es atómico.** Todo corre en una transacción: o la cartera queda entera como estaba en
 *    el respaldo, o queda exactamente como estaba antes. Nunca a medias.
 * 2. **No hay que pelear con el WAL.** Reemplazar el archivo a mano deja los `-wal` y `-shm`
 *    viejos al lado, y SQLite los puede combinar con el archivo nuevo y corromper todo.
 * 3. **Se puede probar.** Al trabajar sobre `EjecutorSQL`, la restauración se prueba con
 *    `node:sqlite` sin emulador — y un respaldo que nunca restauraste no es un respaldo, es
 *    un archivo.
 *
 * Copia solo las columnas que existen en las dos bases, así un respaldo de una versión
 * anterior entra igual y las columnas nuevas toman su valor por defecto. Un respaldo de una
 * versión **más nueva** se rechaza: migrar hacia atrás no se puede.
 */

import type { EjecutorSQL } from './ejecutor';
import { versionDeLaBase, versionObjetivo } from './migrador';

/**
 * Orden de copia: padres antes que hijos, para que las claves foráneas se cumplan sin
 * apagarlas — `PRAGMA foreign_keys` es un no-op dentro de una transacción, así que apagarlas
 * no sería una opción.
 */
export const TABLAS_RESPALDO = [
  'config',
  'clientes',
  'prestamos',
  'obligaciones',
  'pagos',
  'imputaciones',
  'movimientos',
  'caja_movimientos',
  'garantias',
  'garantia_fotos',
] as const;

export type TablaRespaldo = (typeof TABLAS_RESPALDO)[number];

export class RespaldoInvalidoError extends Error {}

/**
 * Quita la marca de modo WAL de una base serializada.
 *
 * La base viva trabaja en modo WAL, y `serializeAsync()` copia esa marca (bytes 18 y 19 de la
 * cabecera en 2). Una base en memoria no puede trabajar en WAL: al abrir un respaldo así,
 * SQLite responde "unable to open database file" y la restauración falla con un archivo que
 * está perfecto. Ponerlos en 1 (modo normal) no cambia ningún dato.
 *
 * Devuelve una copia; no toca los bytes que recibe.
 */
export function sinModoWal(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 20 || bytes[18] !== 2 || bytes[19] !== 2) return bytes;
  const copia = new Uint8Array(bytes);
  copia[18] = 1;
  copia[19] = 1;
  return copia;
}

/**
 * Lo que SQLite devuelve y vuelve a aceptar como parámetro. Sin `bigint`: los montos van en
 * centavos y los identificadores son enteros chicos, así que nada se acerca a 2^53.
 */
type ValorDeColumna = string | number | Uint8Array | null;

/**
 * Los nombres de tabla vienen de `TABLAS_RESPALDO`, una constante del código: `PRAGMA` y los
 * nombres de tabla no admiten parámetros, y esta es la única razón por la que se interpolan.
 */
async function columnasDe(db: EjecutorSQL, tabla: TablaRespaldo): Promise<string[]> {
  const filas = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tabla})`);
  return filas.map((fila) => fila.name);
}

export type ValidacionRespaldo = {
  readonly valido: boolean;
  readonly motivo: string | null;
  readonly version: number;
  readonly clientes: number;
  readonly prestamos: number;
  readonly pagos: number;
};

async function contar(db: EjecutorSQL, tabla: TablaRespaldo): Promise<number> {
  const fila = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla}`);
  return Number(fila?.n ?? 0);
}

/**
 * Revisa un respaldo **antes** de tocar nada. Es lo que evita que un archivo equivocado
 * pise la cartera: el usuario ve qué tiene adentro y decide.
 */
export async function validarContenido(origen: EjecutorSQL): Promise<ValidacionRespaldo> {
  const invalido = (motivo: string): ValidacionRespaldo => ({
    valido: false,
    motivo,
    version: 0,
    clientes: 0,
    prestamos: 0,
    pagos: 0,
  });

  let version: number;
  try {
    version = await versionDeLaBase(origen);
  } catch {
    return invalido('El archivo no es una base de datos de esta app.');
  }

  if (version < 1) {
    return invalido('El archivo no parece un respaldo de esta app.');
  }
  if (version > versionObjetivo()) {
    return invalido(
      `El respaldo es de una versión más nueva de la app (${version}). ` +
        'Actualizá la app antes de restaurarlo.',
    );
  }

  for (const tabla of TABLAS_RESPALDO) {
    const existe = await origen.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      tabla,
    );
    if (!existe) {
      return invalido(`Al respaldo le falta la tabla "${tabla}".`);
    }
  }

  return {
    valido: true,
    motivo: null,
    version,
    clientes: await contar(origen, 'clientes'),
    prestamos: await contar(origen, 'prestamos'),
    pagos: await contar(origen, 'pagos'),
  };
}

/**
 * Reemplaza el contenido de `destino` por el de `origen`.
 *
 * **Correr dentro de `enTransaccion()`** (ver `base.ts`). Si se corta a mitad sin
 * transacción, la cartera queda destruida — es la operación más peligrosa de la app.
 */
export async function copiarContenido(
  origen: EjecutorSQL,
  destino: EjecutorSQL,
): Promise<Record<string, number>> {
  // Al revés: los hijos primero, para no romper las claves foráneas al borrar.
  for (const tabla of [...TABLAS_RESPALDO].reverse()) {
    await destino.runAsync(`DELETE FROM ${tabla}`);
  }

  const copiadas: Record<string, number> = {};

  for (const tabla of TABLAS_RESPALDO) {
    const enOrigen = await columnasDe(origen, tabla);
    const enDestino = await columnasDe(destino, tabla);
    const comunes = enOrigen.filter((columna) => enDestino.includes(columna));

    if (comunes.length === 0) {
      copiadas[tabla] = 0;
      continue;
    }

    const lista = comunes.join(', ');
    const marcadores = comunes.map(() => '?').join(', ');
    const filas = await origen.getAllAsync<Record<string, ValorDeColumna>>(
      `SELECT ${lista} FROM ${tabla} ORDER BY rowid`,
    );

    for (const fila of filas) {
      await destino.runAsync(
        `INSERT INTO ${tabla} (${lista}) VALUES (${marcadores})`,
        ...comunes.map((columna) => fila[columna] ?? null),
      );
    }
    copiadas[tabla] = filas.length;
  }

  return copiadas;
}

export type ResultadoRestauracion = {
  readonly validacion: ValidacionRespaldo;
  readonly copiadas: Record<string, number>;
};

/** Valida y copia. Lanza `RespaldoInvalidoError` sin tocar nada si el respaldo no sirve. */
export async function restaurarContenido(
  origen: EjecutorSQL,
  destino: EjecutorSQL,
): Promise<ResultadoRestauracion> {
  const validacion = await validarContenido(origen);
  if (!validacion.valido) {
    throw new RespaldoInvalidoError(validacion.motivo ?? 'El respaldo no es válido.');
  }
  return { validacion, copiadas: await copiarContenido(origen, destino) };
}
