import type { Migracion } from '../migrador';

/**
 * Esquema inicial.
 *
 * Convenciones que se cumplen en todas las tablas:
 *
 * - **Plata en `INTEGER` de centavos**, con sufijo `_centavos` en el nombre de la columna.
 *   Nunca `REAL`. Un nombre que no dice la unidad es cómo se cuela un error de factor cien.
 * - **Días de calendario en `TEXT` `YYYY-MM-DD`** (`vencimiento`, `fecha`), con un `CHECK`
 *   de formato. **Instantes en `TEXT` ISO completo** (`creado_en`, `revertido_en`). No son el
 *   mismo tipo: guardar un vencimiento como instante corre las fechas un día en UTC−4.
 * - **Nada se borra.** Los estados cierran las entidades; el libro `movimientos` es de solo
 *   inserción y un error se corrige con un asiento de reverso.
 */
export const migracion001: Migracion = {
  version: 1,
  nombre: 'esquema-inicial',
  aplicar: async (db) => {
    await db.execAsync(`
      CREATE TABLE clientes (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre         TEXT    NOT NULL,
        ci             TEXT,
        telefono       TEXT,
        direccion      TEXT,
        referencias    TEXT,
        notas          TEXT,
        activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        creado_en      TEXT    NOT NULL,
        actualizado_en TEXT    NOT NULL
      );

      -- El CI no es UNIQUE ni NOT NULL a propósito: se le presta a gente sin documento a
      -- mano, y forzarlo obligaría a inventar un valor.
      CREATE INDEX idx_clientes_nombre ON clientes (nombre);
      CREATE INDEX idx_clientes_ci     ON clientes (ci);

      CREATE TABLE prestamos (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id          INTEGER NOT NULL REFERENCES clientes (id),
        moneda              TEXT    NOT NULL CHECK (moneda IN ('BOB', 'USD')),
        capital_centavos    INTEGER NOT NULL CHECK (capital_centavos > 0),

        -- Una tasa nunca viaja sola: puntos básicos enteros + su período.
        tasa_puntos_basicos INTEGER NOT NULL CHECK (tasa_puntos_basicos >= 0),
        tasa_periodo        TEXT    NOT NULL
          CHECK (tasa_periodo IN ('diario', 'semanal', 'quincenal', 'mensual', 'anual')),

        modalidad           TEXT    NOT NULL
          CHECK (modalidad IN ('solo_interes', 'cuota_fija', 'capital_fijo',
                               'interes_flat', 'pago_unico')),
        frecuencia          TEXT    NOT NULL
          CHECK (frecuencia IN ('diaria', 'semanal', 'quincenal', 'mensual')),
        cantidad_periodos   INTEGER CHECK (cantidad_periodos IS NULL OR cantidad_periodos > 0),

        fecha_desembolso    TEXT    NOT NULL
          CHECK (fecha_desembolso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        -- NULL = préstamo sin vencimiento de capital. Se admite porque es como se opera hoy,
        -- pero la cartera lo marca: sin fecha, el capital nunca está vencido.
        vencimiento_capital TEXT
          CHECK (vencimiento_capital IS NULL
                 OR vencimiento_capital GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

        -- Reglas propias de este préstamo. NULL = usa lo que diga 'config'.
        mora_tipo                   TEXT
          CHECK (mora_tipo IS NULL OR mora_tipo IN ('porcentaje_diario', 'monto_fijo_diario')),
        mora_puntos_basicos_diarios INTEGER,
        mora_centavos_diarios       INTEGER,
        mora_dias_gracia            INTEGER,
        mora_tope_puntos_basicos    INTEGER,

        estado              TEXT    NOT NULL DEFAULT 'activo'
          CHECK (estado IN ('activo', 'pagado', 'refinanciado', 'garantia_ejecutada',
                            'incobrable', 'anulado')),
        -- Refinanciar no edita el préstamo viejo: lo cierra y abre uno nuevo que lo apunta.
        prestamo_origen_id  INTEGER REFERENCES prestamos (id),
        motivo_cierre       TEXT,
        notas               TEXT,
        creado_en           TEXT    NOT NULL,
        actualizado_en      TEXT    NOT NULL
      );

      CREATE INDEX idx_prestamos_cliente ON prestamos (cliente_id, estado);
      CREATE INDEX idx_prestamos_estado  ON prestamos (estado);

      CREATE TABLE obligaciones (
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
          CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'condonada', 'anulada')),
        -- En una obligación de mora, cuál es la obligación atrasada que la originó.
        obligacion_origen_id INTEGER REFERENCES obligaciones (id),
        -- Clave de idempotencia del devengo: '2026-11' para el interés de ese mes,
        -- 'mora:42' para la mora que crece sobre la obligación 42. NULL en las cuotas de un
        -- cronograma cerrado, que se generan una sola vez al desembolsar.
        periodo              TEXT,
        creado_en            TEXT    NOT NULL,
        actualizado_en       TEXT    NOT NULL,

        -- La base es la última red: nunca se puede cobrar más de lo que se debe.
        CHECK (pagado_capital_centavos <= capital_centavos),
        CHECK (pagado_interes_centavos <= interes_centavos),
        CHECK (pagado_mora_centavos    <= mora_centavos)
      );

      -- Esto es lo que hace imposible duplicar la deuda de una persona. No se reemplaza con
      -- un chequeo en el código: el devengo corre cada vez que se abre la app.
      CREATE UNIQUE INDEX idx_obligaciones_devengo
        ON obligaciones (prestamo_id, tipo, periodo)
        WHERE periodo IS NOT NULL;

      CREATE INDEX idx_obligaciones_prestamo    ON obligaciones (prestamo_id);
      CREATE INDEX idx_obligaciones_vencimiento ON obligaciones (vencimiento, estado);
      CREATE INDEX idx_obligaciones_origen      ON obligaciones (obligacion_origen_id);

      CREATE TABLE pagos (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id        INTEGER NOT NULL REFERENCES clientes (id),
        prestamo_id       INTEGER REFERENCES prestamos (id),
        fecha             TEXT    NOT NULL
          CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        moneda            TEXT    NOT NULL CHECK (moneda IN ('BOB', 'USD')),
        monto_centavos    INTEGER NOT NULL CHECK (monto_centavos > 0),
        medio             TEXT    NOT NULL
          CHECK (medio IN ('efectivo', 'transferencia', 'qr', 'otro')),
        -- Lo que sobró porque ya no había deuda. Queda a favor; devolverlo en efectivo es
        -- una operación de caja aparte.
        sobrante_centavos INTEGER NOT NULL DEFAULT 0 CHECK (sobrante_centavos >= 0),
        imputacion_manual INTEGER NOT NULL DEFAULT 0 CHECK (imputacion_manual IN (0, 1)),
        -- Anular un pago no lo borra: lo marca y deja su asiento de reverso.
        revertido_en      TEXT,
        motivo_reverso    TEXT,
        nota              TEXT,
        creado_en         TEXT    NOT NULL
      );

      CREATE INDEX idx_pagos_fecha    ON pagos (fecha);
      CREATE INDEX idx_pagos_cliente  ON pagos (cliente_id, fecha);
      CREATE INDEX idx_pagos_prestamo ON pagos (prestamo_id);

      CREATE TABLE imputaciones (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        pago_id        INTEGER NOT NULL REFERENCES pagos (id),
        obligacion_id  INTEGER NOT NULL REFERENCES obligaciones (id),
        componente     TEXT    NOT NULL CHECK (componente IN ('mora', 'interes', 'capital')),
        monto_centavos INTEGER NOT NULL CHECK (monto_centavos > 0),
        creado_en      TEXT    NOT NULL
      );

      CREATE INDEX idx_imputaciones_pago       ON imputaciones (pago_id);
      CREATE INDEX idx_imputaciones_obligacion ON imputaciones (obligacion_id);

      -- Libro de solo inserción. Nunca UPDATE, nunca DELETE.
      -- Los montos van con signo: un reverso es negativo. Por eso acá no hay CHECK >= 0.
      CREATE TABLE movimientos (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo                    TEXT    NOT NULL
          CHECK (tipo IN ('desembolso', 'devengo_interes', 'devengo_mora', 'pago',
                          'condonacion', 'reverso', 'refinanciacion', 'ajuste', 'garantia')),
        fecha                   TEXT    NOT NULL
          CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        cliente_id              INTEGER REFERENCES clientes (id),
        prestamo_id             INTEGER REFERENCES prestamos (id),
        obligacion_id           INTEGER REFERENCES obligaciones (id),
        pago_id                 INTEGER REFERENCES pagos (id),
        moneda                  TEXT    CHECK (moneda IS NULL OR moneda IN ('BOB', 'USD')),
        capital_centavos        INTEGER NOT NULL DEFAULT 0,
        interes_centavos        INTEGER NOT NULL DEFAULT 0,
        mora_centavos           INTEGER NOT NULL DEFAULT 0,
        movimiento_revertido_id INTEGER REFERENCES movimientos (id),
        detalle                 TEXT,
        -- Hoy siempre es el dueño, pero el campo existe desde el primer día para que
        -- agregar una segunda persona no obligue a rehacer la auditoría.
        autor                   TEXT    NOT NULL DEFAULT 'dueño',
        creado_en               TEXT    NOT NULL
      );

      CREATE INDEX idx_movimientos_fecha    ON movimientos (fecha);
      CREATE INDEX idx_movimientos_prestamo ON movimientos (prestamo_id);
      CREATE INDEX idx_movimientos_tipo     ON movimientos (tipo, fecha);

      -- Caja: cuánta plata hay en la mano frente a cuánta está colocada.
      -- El monto va con signo (cobro positivo, desembolso negativo) para poder sumar.
      CREATE TABLE caja_movimientos (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo           TEXT    NOT NULL
          CHECK (tipo IN ('cobro', 'desembolso', 'retiro', 'aporte', 'gasto', 'ajuste')),
        fecha          TEXT    NOT NULL
          CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        moneda         TEXT    NOT NULL CHECK (moneda IN ('BOB', 'USD')),
        monto_centavos INTEGER NOT NULL,
        pago_id        INTEGER REFERENCES pagos (id),
        prestamo_id    INTEGER REFERENCES prestamos (id),
        detalle        TEXT,
        creado_en      TEXT    NOT NULL
      );

      CREATE INDEX idx_caja_fecha ON caja_movimientos (fecha, moneda);

      CREATE TABLE garantias (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        prestamo_id             INTEGER NOT NULL REFERENCES prestamos (id),
        descripcion             TEXT    NOT NULL,
        valor_estimado_centavos INTEGER CHECK (valor_estimado_centavos IS NULL
                                               OR valor_estimado_centavos >= 0),
        moneda                  TEXT    CHECK (moneda IS NULL OR moneda IN ('BOB', 'USD')),
        -- Dónde está guardada. Es lo que protege del reclamo de "te dejé el anillo".
        ubicacion               TEXT,
        estado                  TEXT    NOT NULL DEFAULT 'en_custodia'
          CHECK (estado IN ('en_custodia', 'devuelta', 'ejecutada')),
        fecha_recepcion         TEXT    NOT NULL
          CHECK (fecha_recepcion GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        fecha_salida            TEXT,
        destino                 TEXT,
        creado_en               TEXT    NOT NULL,
        actualizado_en          TEXT    NOT NULL
      );

      CREATE INDEX idx_garantias_prestamo ON garantias (prestamo_id, estado);

      CREATE TABLE garantia_fotos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        garantia_id INTEGER NOT NULL REFERENCES garantias (id),
        uri         TEXT    NOT NULL,
        creado_en   TEXT    NOT NULL
      );

      CREATE INDEX idx_garantia_fotos ON garantia_fotos (garantia_id);

      -- Las reglas del negocio viven acá, no en el código.
      CREATE TABLE config (
        clave          TEXT PRIMARY KEY,
        valor          TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
    `);

    const ahora = new Date().toISOString();
    const valoresPorDefecto: [string, string][] = [
      ['mora_tipo', 'porcentaje_diario'],
      ['mora_puntos_basicos_diarios', '50'],
      ['mora_centavos_diarios', '1000'],
      ['mora_dias_gracia', '3'],
      ['mora_tope_puntos_basicos', '2000'],
      ['orden_componentes', 'mora,interes,capital'],
      ['regla_pago_adelantado', 'prorratear_por_dias'],
      ['meses_vencimiento_capital', '6'],
      ['moneda_preferida', 'BOB'],
      // Vacío a propósito: la tasa es entrada libre y no hay tope de mercado.
      ['aviso_tasa_puntos_basicos', ''],
      ['dias_sin_respaldo_para_avisar', '7'],
    ];

    for (const [clave, valor] of valoresPorDefecto) {
      await db.runAsync(
        'INSERT INTO config (clave, valor, actualizado_en) VALUES (?, ?, ?)',
        clave,
        valor,
        ahora,
      );
    }
  },
};
