/**
 * Restaurar un respaldo sobre la base viva.
 *
 * Vive en su propio archivo y no dentro de `respaldo.ts` por una razón concreta: necesita
 * `enTransaccion()` de `base.ts`, y `base.ts` necesita `tomarRespaldo()` de `respaldo.ts`
 * para guardar una copia antes de migrar. Si todo estuviera junto habría un ciclo de
 * importaciones.
 */

import * as SQLite from 'expo-sqlite';

import type { Instante } from '../nucleo/fechas';
import { enTransaccion } from './base';
import { escribirConfiguracion } from './repositorios/config';
import {
  CLAVE_ULTIMO_RESPALDO,
  tomarRespaldo,
  type Respaldo,
} from './respaldo';
import {
  RespaldoInvalidoError,
  restaurarContenido,
  validarContenido,
  type ResultadoRestauracion,
} from './restaurar';

export type ResultadoRestauracionCompleta = {
  readonly resultado: ResultadoRestauracion;
  /** La cartera como estaba antes de restaurar, por si el usuario se equivocó de archivo. */
  readonly respaldoDeSeguridad: Respaldo;
};

/**
 * Tres seguros, en este orden: **revisar** el archivo antes de tocar nada, **guardar** la
 * cartera actual, y **copiar en una transacción** para que no pueda quedar a medias.
 */
export async function restaurarDesdeBytes(
  db: SQLite.SQLiteDatabase,
  bytes: Uint8Array,
  ahora: Instante,
): Promise<ResultadoRestauracionCompleta> {
  let memoria: SQLite.SQLiteDatabase;
  try {
    memoria = await SQLite.deserializeDatabaseAsync(bytes);
  } catch {
    throw new RespaldoInvalidoError('El archivo no es una base de datos.');
  }

  try {
    const validacion = await validarContenido(memoria);
    if (!validacion.valido) {
      throw new RespaldoInvalidoError(validacion.motivo ?? 'El respaldo no es válido.');
    }

    const respaldoDeSeguridad = await tomarRespaldo(db, {
      etiqueta: 'antes-de-restaurar',
      ahora,
    });

    const resultado = await enTransaccion(db, () => restaurarContenido(memoria, db));

    // La copia restaurada existe como archivo en manos del usuario, así que los datos que
    // quedaron sí están respaldados: el aviso de "hace días que no respaldás" se reinicia.
    await escribirConfiguracion(db, CLAVE_ULTIMO_RESPALDO, ahora, ahora);

    return { resultado, respaldoDeSeguridad };
  } finally {
    await memoria.closeAsync();
  }
}
