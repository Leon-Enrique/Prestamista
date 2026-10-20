import type { Migracion } from '../migrador';

/**
 * Agrega el estado `refinanciada` a las obligaciones.
 *
 * Cuando un préstamo se refinancia, su deuda pendiente **se muda** al préstamo nuevo. Esas
 * obligaciones no quedan pagadas (nadie pagó) ni condonadas (nadie perdonó): se trasladaron.
 * Sin un estado propio habría que mentir en los reportes, y "cuánta deuda se movió" dejaría
 * de poder distinguirse de "cuánto se anuló por error".
 *
 * SQLite no sabe modificar un `CHECK` con `ALTER TABLE`, así que hay que **reconstruir la
 * tabla**: crear la nueva, copiar, borrar la vieja, renombrar. Por eso lleva
 * `reconstruyeTablas: true`, que apaga las claves foráneas alrededor de la transacción y
 * después comprueba que no quedaron referencias huérfanas.
 *
 * Los índices se van con la tabla vieja, así que se vuelven a crear acá — en especial el
 * único de idempotencia del devengo, que es lo que hace imposible duplicar la deuda de
 * alguien.
 */
export const migracion002: Migracion = {
  version: 2,
  nombre: 'obligacion-refinanciada',
  reconstruyeTablas: true,
  aplicar: async (db) => {
    await db.execAsync(`
      CREATE TABLE obligaciones_nueva (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        prestamo_id          INTEGER NOT NULL REFERENCES prestamos (id),
        tipo                 TEXT    NOT NULL
          CHECK (tipo IN ('cuota', 'interes', 'capital', 'mora')),
        numero               INTEGER,
        vencimiento          TEXT
          CHECK (vencimiento IS NULL
                 OR vencimiento GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        moneda               TEXT    NOT NULL CHECK (moneda IN ('BOB', 'USD')),

        capital_centavos        INTEGER NOT NULL DEFAULT 0 CHECK (capital_centavos >= 0),
        interes_centavos        INTEGER NOT NULL DEFAULT 0 CHECK (interes_centavos >= 0),
        mora_centavos           INTEGER NOT NULL DEFAULT 0 CHECK (mora_centavos >= 0),
        pagado_capital_centavos INTEGER NOT NULL DEFAULT 0 CHECK (pagado_capital_centavos >= 0),
        pagado_interes_centavos INTEGER NOT NULL DEFAULT 0 CHECK (pagado_interes_centavos >= 0),
        pagado_mora_centavos    INTEGER NOT NULL DEFAULT 0 CHECK (pagado_mora_centavos >= 0),

        estado               TEXT    NOT NULL DEFAULT 'pendiente'
          CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'condonada', 'anulada',
                            'refinanciada')),
        obligacion_origen_id INTEGER REFERENCES obligaciones (id),
        periodo              TEXT,
        creado_en            TEXT    NOT NULL,
        actualizado_en       TEXT    NOT NULL,

        CHECK (pagado_capital_centavos <= capital_centavos),
        CHECK (pagado_interes_centavos <= interes_centavos),
        CHECK (pagado_mora_centavos    <= mora_centavos)
      );

      INSERT INTO obligaciones_nueva
        SELECT id, prestamo_id, tipo, numero, vencimiento, moneda,
               capital_centavos, interes_centavos, mora_centavos,
               pagado_capital_centavos, pagado_interes_centavos, pagado_mora_centavos,
               estado, obligacion_origen_id, periodo, creado_en, actualizado_en
          FROM obligaciones;

      DROP TABLE obligaciones;
      ALTER TABLE obligaciones_nueva RENAME TO obligaciones;

      CREATE UNIQUE INDEX idx_obligaciones_devengo
        ON obligaciones (prestamo_id, tipo, periodo)
        WHERE periodo IS NOT NULL;

      CREATE INDEX idx_obligaciones_prestamo    ON obligaciones (prestamo_id);
      CREATE INDEX idx_obligaciones_vencimiento ON obligaciones (vencimiento, estado);
      CREATE INDEX idx_obligaciones_origen      ON obligaciones (obligacion_origen_id);
    `);
  },
};
