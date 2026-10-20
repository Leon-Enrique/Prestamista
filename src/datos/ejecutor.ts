/**
 * Lo mínimo que un repositorio o un servicio necesita de la base.
 *
 * Depender de esta forma y no de `SQLiteDatabase` entero tiene una ventaja concreta: la
 * `Transaction` de expo-sqlite la satisface, y también la satisface un adaptador de cuatro
 * métodos sobre `node:sqlite`. Por eso los repositorios y los servicios se pueden probar
 * enteros, con SQL real, sin emulador y sin dispositivo.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

export type EjecutorSQL = Pick<
  SQLiteDatabase,
  'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync'
>;
