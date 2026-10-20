/**
 * ⚠️ **Solo para pruebas.** Importa `node:sqlite`, que no existe en el dispositivo.
 * Ningún archivo de la app debe importar este módulo.
 *
 * Levanta una base en memoria con todas las migraciones aplicadas y la expone con la forma
 * `EjecutorSQL`, la misma que usan los repositorios y los servicios. Por eso se puede probar
 * el flujo completo —desembolsar, devengar, cobrar— con SQL real, sin emulador y sin
 * dispositivo, en milisegundos.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type { EjecutorSQL } from './ejecutor';
import { MIGRACIONES, type Migracion } from './migrador';

export type BaseDePrueba = {
  readonly db: EjecutorSQL;
  /** Acceso directo, para verificar filas crudas en las pruebas del esquema. */
  readonly sqlite: DatabaseSync;
  readonly cerrar: () => void;
};

/**
 * Adapta `node:sqlite` a `EjecutorSQL`. El `as` es a propósito: las firmas sobrecargadas de
 * expo-sqlite no se pueden reproducir exactamente, y lo único que el código usa de ellas es
 * `execAsync`, `runAsync`, `getFirstAsync` y `getAllAsync`.
 */
export function adaptar(sqlite: DatabaseSync): EjecutorSQL {
  const preparar = (source: string): StatementSync => sqlite.prepare(source);

  return {
    execAsync: async (source: string) => {
      sqlite.exec(source);
    },
    runAsync: async (source: string, ...params: unknown[]) => {
      const resultado = preparar(source).run(...(params as never[]));
      return {
        changes: Number(resultado.changes),
        lastInsertRowId: Number(resultado.lastInsertRowid),
      };
    },
    getFirstAsync: async (source: string, ...params: unknown[]) =>
      preparar(source).get(...(params as never[])) ?? null,
    getAllAsync: async (source: string, ...params: unknown[]) =>
      preparar(source).all(...(params as never[])),
  } as unknown as EjecutorSQL;
}

/**
 * Aplica una migración como lo hace el corredor de verdad: apagando las claves foráneas si
 * reconstruye tablas, y comprobando después que no quedaron referencias huérfanas.
 */
export async function aplicarMigracion(
  sqlite: DatabaseSync,
  db: EjecutorSQL,
  migracion: Migracion,
): Promise<void> {
  if (migracion.reconstruyeTablas) sqlite.exec('PRAGMA foreign_keys = OFF');
  await migracion.aplicar(db);
  sqlite.exec(`PRAGMA user_version = ${migracion.version}`);

  if (migracion.reconstruyeTablas) {
    const huerfanas = sqlite.prepare('PRAGMA foreign_key_check').all();
    sqlite.exec('PRAGMA foreign_keys = ON');
    if (huerfanas.length > 0) {
      throw new Error(
        `La migración ${migracion.version} dejó ${huerfanas.length} referencias huérfanas.`,
      );
    }
  }
}

/**
 * `hastaVersion` permite quedarse en una versión anterior del esquema, que es lo que hace
 * falta para probar una migración **sobre datos ya cargados** — el caso real, no una base
 * vacía. Es lo que el checklist de `pre-release` exige verificar.
 */
export async function crearBaseDePrueba(
  opciones: { hastaVersion?: number } = {},
): Promise<BaseDePrueba> {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');

  const db = adaptar(sqlite);
  const hasta = opciones.hastaVersion ?? Number.MAX_SAFE_INTEGER;

  for (const migracion of MIGRACIONES) {
    if (migracion.version > hasta) break;
    await aplicarMigracion(sqlite, db, migracion);
  }

  return { db, sqlite, cerrar: () => sqlite.close() };
}
