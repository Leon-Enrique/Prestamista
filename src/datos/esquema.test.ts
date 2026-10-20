/**
 * Pruebas del esquema contra SQLite de verdad.
 *
 * Usan `node:sqlite` (viene con Node) en vez de expo-sqlite, que solo corre en el
 * dispositivo. El SQL es el mismo, así que esto verifica lo que el checklist de
 * `pre-release` pide comprobar: que los `CHECK` y las restricciones de unicidad **existen
 * realmente en la base**, no solo en el código.
 */

import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba } from './baseDePrueba';

let db: DatabaseSync;

beforeEach(async () => {
  db = (await crearBaseDePrueba()).sqlite;
});

const AHORA = '2026-10-09T17:00:00.000Z';

function insertarCliente(): number {
  const resultado = db
    .prepare(
      'INSERT INTO clientes (nombre, creado_en, actualizado_en) VALUES (?, ?, ?)',
    )
    .run('Juan Pérez', AHORA, AHORA);
  return Number(resultado.lastInsertRowid);
}

function insertarPrestamo(overrides: Record<string, unknown> = {}): number {
  const campos = {
    cliente_id: insertarCliente(),
    moneda: 'BOB',
    capital_centavos: 600_000,
    tasa_puntos_basicos: 1000,
    tasa_periodo: 'mensual',
    modalidad: 'solo_interes',
    frecuencia: 'mensual',
    cantidad_periodos: null,
    fecha_desembolso: '2026-10-09',
    vencimiento_capital: '2027-04-09',
    creado_en: AHORA,
    actualizado_en: AHORA,
    ...overrides,
  };
  const claves = Object.keys(campos);
  const resultado = db
    .prepare(
      `INSERT INTO prestamos (${claves.join(', ')}) VALUES (${claves.map(() => '?').join(', ')})`,
    )
    .run(...(Object.values(campos) as never[]));
  return Number(resultado.lastInsertRowid);
}

function insertarObligacion(overrides: Record<string, unknown> = {}): number {
  const campos = {
    prestamo_id: insertarPrestamo(),
    tipo: 'interes',
    numero: 1,
    vencimiento: '2026-11-09',
    moneda: 'BOB',
    interes_centavos: 60_000,
    periodo: '2026-11',
    creado_en: AHORA,
    actualizado_en: AHORA,
    ...overrides,
  };
  const claves = Object.keys(campos);
  const resultado = db
    .prepare(
      `INSERT INTO obligaciones (${claves.join(', ')}) VALUES (${claves.map(() => '?').join(', ')})`,
    )
    .run(...(Object.values(campos) as never[]));
  return Number(resultado.lastInsertRowid);
}

describe('la migración se aplica', () => {
  it('crea todas las tablas', () => {
    const tablas = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((fila) => (fila as { name: string }).name)
      .sort();

    expect(tablas).toEqual([
      'caja_movimientos',
      'clientes',
      'config',
      'garantia_fotos',
      'garantias',
      'imputaciones',
      'movimientos',
      'obligaciones',
      'pagos',
      'prestamos',
    ]);
  });

  it('siembra la configuración por defecto', () => {
    const filas = db.prepare('SELECT clave, valor FROM config').all() as {
      clave: string;
      valor: string;
    }[];
    const config = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));

    expect(config.mora_puntos_basicos_diarios).toBe('50');
    expect(config.mora_dias_gracia).toBe('3');
    expect(config.mora_tope_puntos_basicos).toBe('2000');
    expect(config.orden_componentes).toBe('mora,interes,capital');
    expect(config.regla_pago_adelantado).toBe('prorratear_por_dias');
    // La tasa es entrada libre: el aviso arranca vacío, sin tope inventado.
    expect(config.aviso_tasa_puntos_basicos).toBe('');
  });
});

describe('ninguna columna de plata es REAL', () => {
  it('todas las columnas de montos son INTEGER', () => {
    const tablas = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((fila) => (fila as { name: string }).name);

    const sospechosas: string[] = [];
    for (const tabla of tablas) {
      const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all() as {
        name: string;
        type: string;
      }[];
      for (const columna of columnas) {
        if (columna.type.toUpperCase().includes('REAL')) {
          sospechosas.push(`${tabla}.${columna.name}`);
        }
        if (/centavos|monto|valor_estimado/.test(columna.name) && columna.type !== 'INTEGER') {
          sospechosas.push(`${tabla}.${columna.name} (${columna.type})`);
        }
      }
    }

    expect(sospechosas).toEqual([]);
  });
});

describe('idempotencia del devengo', () => {
  it('no deja devengar dos veces el mismo período del mismo préstamo', () => {
    const prestamoId = insertarPrestamo();

    const devengar = () =>
      db
        .prepare(
          `INSERT INTO obligaciones
             (prestamo_id, tipo, vencimiento, moneda, interes_centavos, periodo, creado_en, actualizado_en)
           VALUES (?, 'interes', '2026-11-09', 'BOB', 60000, '2026-11', ?, ?)`,
        )
        .run(prestamoId, AHORA, AHORA);

    devengar();
    // Esto es lo que impide duplicar la deuda de una persona real cuando la app se abre
    // y se cierra varias veces el mismo día.
    expect(devengar).toThrow(/UNIQUE/i);
  });

  it('deja devengar el mismo período en préstamos distintos', () => {
    const primero = insertarPrestamo();
    const segundo = insertarPrestamo();

    const devengar = (prestamoId: number) =>
      db
        .prepare(
          `INSERT INTO obligaciones
             (prestamo_id, tipo, vencimiento, moneda, interes_centavos, periodo, creado_en, actualizado_en)
           VALUES (?, 'interes', '2026-11-09', 'BOB', 60000, '2026-11', ?, ?)`,
        )
        .run(prestamoId, AHORA, AHORA);

    expect(() => devengar(primero)).not.toThrow();
    expect(() => devengar(segundo)).not.toThrow();
  });

  it('las cuotas de un cronograma cerrado no chocan entre sí: su periodo es NULL', () => {
    const prestamoId = insertarPrestamo({ modalidad: 'cuota_fija', cantidad_periodos: 4 });

    const insertarCuota = (numero: number) =>
      db
        .prepare(
          `INSERT INTO obligaciones
             (prestamo_id, tipo, numero, vencimiento, moneda, capital_centavos, interes_centavos,
              periodo, creado_en, actualizado_en)
           VALUES (?, 'cuota', ?, '2026-11-09', 'BOB', 25000, 5000, NULL, ?, ?)`,
        )
        .run(prestamoId, numero, AHORA, AHORA);

    expect(() => {
      insertarCuota(1);
      insertarCuota(2);
      insertarCuota(3);
    }).not.toThrow();
  });
});

describe('la base es la última red', () => {
  it('no deja cobrar más de lo que se debe en un componente', () => {
    const obligacionId = insertarObligacion();
    expect(() =>
      db
        .prepare('UPDATE obligaciones SET pagado_interes_centavos = ? WHERE id = ?')
        .run(60_001, obligacionId),
    ).toThrow(/CHECK/i);
  });

  it('acepta cobrar exactamente lo que se debe', () => {
    const obligacionId = insertarObligacion();
    expect(() =>
      db
        .prepare('UPDATE obligaciones SET pagado_interes_centavos = ? WHERE id = ?')
        .run(60_000, obligacionId),
    ).not.toThrow();
  });

  it('rechaza montos negativos en una obligación', () => {
    expect(() => insertarObligacion({ interes_centavos: -100 })).toThrow(/CHECK/i);
  });

  it('rechaza un préstamo con capital en cero o negativo', () => {
    expect(() => insertarPrestamo({ capital_centavos: 0 })).toThrow(/CHECK/i);
    expect(() => insertarPrestamo({ capital_centavos: -1 })).toThrow(/CHECK/i);
  });

  it('rechaza un pago de cero: anular es un reverso, no un pago negativo', () => {
    const clienteId = insertarCliente();
    expect(() =>
      db
        .prepare(
          `INSERT INTO pagos (cliente_id, fecha, moneda, monto_centavos, medio, creado_en)
           VALUES (?, '2026-10-09', 'BOB', 0, 'efectivo', ?)`,
        )
        .run(clienteId, AHORA),
    ).toThrow(/CHECK/i);
  });

  it('rechaza una moneda que no existe', () => {
    expect(() => insertarPrestamo({ moneda: 'ARS' })).toThrow(/CHECK/i);
  });

  it('rechaza una modalidad desconocida', () => {
    expect(() => insertarPrestamo({ modalidad: 'gota_a_gota' })).toThrow(/CHECK/i);
  });
});

describe('un vencimiento es un día, no un instante', () => {
  it('rechaza una fecha con hora', () => {
    expect(() => insertarPrestamo({ fecha_desembolso: '2026-10-09T00:00:00Z' })).toThrow(
      /CHECK/i,
    );
  });

  it('rechaza otro formato de fecha', () => {
    expect(() => insertarPrestamo({ fecha_desembolso: '09/10/2026' })).toThrow(/CHECK/i);
  });

  it('acepta un día bien formado y permite capital sin vencimiento', () => {
    expect(() => insertarPrestamo({ vencimiento_capital: null })).not.toThrow();
  });
});

describe('claves foráneas', () => {
  it('no deja una obligación de un préstamo que no existe', () => {
    expect(() => insertarObligacion({ prestamo_id: 9999 })).toThrow(/FOREIGN KEY/i);
  });

  it('no deja una imputación de una obligación que no existe', () => {
    const clienteId = insertarCliente();
    const pagoId = Number(
      db
        .prepare(
          `INSERT INTO pagos (cliente_id, fecha, moneda, monto_centavos, medio, creado_en)
           VALUES (?, '2026-10-09', 'BOB', 40000, 'efectivo', ?)`,
        )
        .run(clienteId, AHORA).lastInsertRowid,
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO imputaciones (pago_id, obligacion_id, componente, monto_centavos, creado_en)
           VALUES (?, 9999, 'interes', 40000, ?)`,
        )
        .run(pagoId, AHORA),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('el libro admite asientos con signo', () => {
  it('deja registrar un reverso en negativo', () => {
    const prestamoId = insertarPrestamo();
    expect(() =>
      db
        .prepare(
          `INSERT INTO movimientos
             (tipo, fecha, prestamo_id, moneda, interes_centavos, detalle, creado_en)
           VALUES ('reverso', '2026-10-11', ?, 'BOB', -60000, 'pago anulado', ?)`,
        )
        .run(prestamoId, AHORA),
    ).not.toThrow();
  });
});
