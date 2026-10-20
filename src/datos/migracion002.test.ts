/**
 * La migración 002 **sobre datos ya cargados**.
 *
 * Es el caso real, y el que el checklist de `pre-release` exige: una migración que anda sobre
 * una base vacía y rompe con datos adentro es lo normal, no la excepción. Esta reconstruye la
 * tabla de obligaciones —crear la nueva, copiar, borrar, renombrar— con pagos, imputaciones y
 * asientos del libro ya apuntando a esas filas.
 *
 * Lo que tiene que quedar demostrado: que no se pierde ni una fila, que las referencias
 * siguen en pie, que los índices se volvieron a crear (en especial el único de idempotencia
 * del devengo), y que después se puede seguir operando con normalidad.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { cobrar } from '../servicios/cobrar';
import { desembolsar } from '../servicios/desembolsar';
import { devengar } from '../servicios/devengar';
import { resumenDeuda } from '../dominio/obligaciones';
import type { Condiciones } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { aplicarMigracion, crearBaseDePrueba, type BaseDePrueba } from './baseDePrueba';
import { migracion002 } from './migraciones/002-obligacion-refinanciada';
import { versionDeLaBase } from './migrador';
import { crearCliente } from './repositorios/clientes';
import { obligacionesDePrestamo } from './repositorios/obligaciones';
import { verificar } from './verificacion';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;
const DESEMBOLSO = dia('2026-10-09');
const PRIMER_VENCIMIENTO = dia('2026-11-09');
const DIEZ_DIAS_TARDE = dia('2026-11-19');

let base: BaseDePrueba;
let prestamoId: number;

const condiciones: Condiciones = {
  capital: desdeUnidades(6000, 'BOB'),
  tasa: tasaDesdePorcentaje(10, 'mensual'),
  modalidad: 'solo_interes',
  frecuencia: 'mensual',
  cantidadPeriodos: null,
  fechaDesembolso: DESEMBOLSO,
  vencimientoCapital: dia('2027-04-09'),
};

const contar = (tabla: string): number =>
  Number((base.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n);

beforeEach(async () => {
  // Arranca en la versión 1: el esquema que ya está instalado en el celular.
  base = await crearBaseDePrueba({ hastaVersion: 1 });

  const clienteId = await crearCliente(base.db, { nombre: 'Juan Pérez', ci: '1234567' }, AHORA);
  const desembolso = await desembolsar(base.db, { clienteId, condiciones, ahora: AHORA });
  prestamoId = desembolso.prestamoId;

  await devengar(base.db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
  await devengar(base.db, { hoy: DIEZ_DIAS_TARDE, ahora: AHORA });
  await cobrar(base.db, {
    prestamoId,
    monto: desdeUnidades(400, 'BOB'),
    fecha: DIEZ_DIAS_TARDE,
    medio: 'efectivo',
    ahora: AHORA,
  });
});

describe('antes de migrar', () => {
  it('la base está en la versión 1 y no acepta el estado nuevo', async () => {
    expect(await versionDeLaBase(base.db)).toBe(1);
    expect(() =>
      base.sqlite
        .prepare("UPDATE obligaciones SET estado = 'refinanciada' WHERE id = 1")
        .run(),
    ).toThrow(/CHECK/i);
  });
});

describe('migrar con datos adentro', () => {
  it('no pierde ninguna fila', async () => {
    const antes = {
      obligaciones: contar('obligaciones'),
      pagos: contar('pagos'),
      imputaciones: contar('imputaciones'),
      movimientos: contar('movimientos'),
    };
    expect(antes.obligaciones).toBeGreaterThan(0);
    expect(antes.imputaciones).toBeGreaterThan(0);

    await aplicarMigracion(base.sqlite, base.db, migracion002);

    expect(contar('obligaciones')).toBe(antes.obligaciones);
    expect(contar('pagos')).toBe(antes.pagos);
    expect(contar('imputaciones')).toBe(antes.imputaciones);
    expect(contar('movimientos')).toBe(antes.movimientos);
    expect(await versionDeLaBase(base.db)).toBe(2);
  });

  it('conserva los saldos exactos', async () => {
    const antes = resumenDeuda(
      await obligacionesDePrestamo(base.db, prestamoId),
      'BOB',
      DIEZ_DIAS_TARDE,
    );

    await aplicarMigracion(base.sqlite, base.db, migracion002);

    const despues = resumenDeuda(
      await obligacionesDePrestamo(base.db, prestamoId),
      'BOB',
      DIEZ_DIAS_TARDE,
    );
    expect(formatear(despues.capital)).toBe(formatear(antes.capital));
    expect(formatear(despues.interes)).toBe(formatear(antes.interes));
    expect(formatear(despues.mora)).toBe(formatear(antes.mora));
    expect(formatear(despues.interes)).toBe('Bs 221,00');
  });

  it('no deja referencias huérfanas', async () => {
    // `aplicarMigracion` corre `PRAGMA foreign_key_check` y lanza si encuentra algo, así que
    // que esto no explote ya es la mitad de la prueba. La otra mitad es comprobar a mano que
    // cada imputación sigue encontrando su obligación.
    await aplicarMigracion(base.sqlite, base.db, migracion002);

    const sueltas = base.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM imputaciones i
          LEFT JOIN obligaciones o ON o.id = i.obligacion_id
          WHERE o.id IS NULL`,
      )
      .get() as { n: number };
    expect(Number(sueltas.n)).toBe(0);

    const asientosSueltos = base.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM movimientos m
          LEFT JOIN obligaciones o ON o.id = m.obligacion_id
          WHERE m.obligacion_id IS NOT NULL AND o.id IS NULL`,
      )
      .get() as { n: number };
    expect(Number(asientosSueltos.n)).toBe(0);
  });

  it('conserva el enlace de la mora con la obligación que penaliza', async () => {
    await aplicarMigracion(base.sqlite, base.db, migracion002);

    const obligaciones = await obligacionesDePrestamo(base.db, prestamoId);
    const mora = obligaciones.find((o) => o.tipo === 'mora')!;
    const origen = obligaciones.find((o) => o.id === mora.obligacionOrigenId);

    expect(origen).toBeDefined();
    expect(origen!.tipo).toBe('interes');
  });

  it('vuelve a crear el índice único que impide duplicar deuda', async () => {
    await aplicarMigracion(base.sqlite, base.db, migracion002);

    const indices = base.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'obligaciones'")
      .all()
      .map((fila) => (fila as { name: string }).name);

    expect(indices).toContain('idx_obligaciones_devengo');
    expect(indices).toContain('idx_obligaciones_vencimiento');

    // Y que de verdad funcione, no solo que exista.
    expect(() =>
      base.sqlite
        .prepare(
          `INSERT INTO obligaciones
             (prestamo_id, tipo, vencimiento, moneda, interes_centavos, periodo, creado_en, actualizado_en)
           VALUES (?, 'interes', '2026-11-09', 'BOB', 60000, '2026-11-09', ?, ?)`,
        )
        .run(prestamoId, AHORA, AHORA),
    ).toThrow(/UNIQUE/i);
  });

  it('ahora sí acepta el estado refinanciada, y sigue rechazando uno inventado', async () => {
    await aplicarMigracion(base.sqlite, base.db, migracion002);

    const obligaciones = await obligacionesDePrestamo(base.db, prestamoId);
    expect(() =>
      base.sqlite
        .prepare("UPDATE obligaciones SET estado = 'refinanciada' WHERE id = ?")
        .run(obligaciones[0].id),
    ).not.toThrow();

    expect(() =>
      base.sqlite
        .prepare("UPDATE obligaciones SET estado = 'cualquier_cosa' WHERE id = ?")
        .run(obligaciones[0].id),
    ).toThrow(/CHECK/i);
  });

  it('conserva los CHECK que protegen los montos', async () => {
    await aplicarMigracion(base.sqlite, base.db, migracion002);
    const obligaciones = await obligacionesDePrestamo(base.db, prestamoId);
    const interes = obligaciones.find((o) => o.tipo === 'interes')!;

    expect(() =>
      base.sqlite
        .prepare('UPDATE obligaciones SET pagado_interes_centavos = ? WHERE id = ?')
        .run(interes.interes.centavos + 1, interes.id),
    ).toThrow(/CHECK/i);
  });
});

describe('después de migrar se sigue trabajando', () => {
  it('el libro cuadra, el devengo sigue siendo idempotente y se puede cobrar', async () => {
    await aplicarMigracion(base.sqlite, base.db, migracion002);

    expect((await verificar(base.db)).cuadra).toBe(true);

    const devengo = await devengar(base.db, { hoy: DIEZ_DIAS_TARDE, ahora: AHORA });
    expect(devengo.interesesCreados).toBe(0);

    const resultado = await cobrar(base.db, {
      prestamoId,
      monto: desdeUnidades(221, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect(formatear(resultado.desglose.interes)).toBe('Bs 221,00');
    expect((await verificar(base.db)).cuadra).toBe(true);
  });
});
