/**
 * Pruebas de refinanciar.
 *
 * Lo que tiene que quedar demostrado: que el préstamo viejo **no se edita**, que la deuda se
 * traslada sin quedar contada dos veces, que solo la plata nueva sale de la caja, y que el
 * rastro entre los dos préstamos sobrevive.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import { comportamientoDeCliente, totalesDeCartera } from '../datos/consultas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { crearCliente } from '../datos/repositorios/clientes';
import { obligacionesDePrestamo } from '../datos/repositorios/obligaciones';
import { obtenerPrestamo } from '../datos/repositorios/prestamos';
import { verificar } from '../datos/verificacion';
import { resumenDeuda } from '../dominio/obligaciones';
import type { Condiciones } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { MonedaIncompatibleError } from '../nucleo/errores';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from './cobrar';
import { desembolsar } from './desembolsar';
import { devengar } from './devengar';
import { NoSePuedeRefinanciarError, refinanciar } from './refinanciar';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;
const DESEMBOLSO = dia('2026-10-09');
const PRIMER_VENCIMIENTO = dia('2026-11-09');

let base: BaseDePrueba;
let db: EjecutorSQL;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  db = base.db;
});

function condiciones(overrides: Partial<Condiciones> = {}): Condiciones {
  return {
    capital: desdeUnidades(6000, 'BOB'),
    tasa: tasaDesdePorcentaje(10, 'mensual'),
    modalidad: 'solo_interes',
    frecuencia: 'mensual',
    cantidadPeriodos: null,
    fechaDesembolso: DESEMBOLSO,
    vencimientoCapital: dia('2027-04-09'),
    ...overrides,
  };
}

/** Bs 6.000 al 10%, con un mes de interés devengado e impago: debe Bs 6.600. */
async function prestamoConUnMes(): Promise<{ clienteId: number; prestamoId: number }> {
  const clienteId = await crearCliente(db, { nombre: 'Juan Pérez' }, AHORA);
  const { prestamoId } = await desembolsar(db, {
    clienteId,
    condiciones: condiciones(),
    ahora: AHORA,
  });
  await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
  return { clienteId, prestamoId };
}

describe('renovar sin entregar plata', () => {
  it('traslada el saldo entero al préstamo nuevo', async () => {
    const { prestamoId } = await prestamoConUnMes();

    const resultado = await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({
        capital: desdeUnidades(6600, 'BOB'),
        fechaDesembolso: PRIMER_VENCIMIENTO,
        vencimientoCapital: dia('2027-05-09'),
      }),
      motivo: 'No pudo pagar, le damos seis meses más',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    expect(formatear(resultado.saldoTrasladado)).toBe('Bs 6.600,00');
    expect(resultado.obligacionesTrasladadas).toBe(2);
    expect(formatear(resultado.diferenciaAcordada)).toBe('Bs 0,00');
  });

  it('el préstamo viejo se cierra y no se edita', async () => {
    const { prestamoId } = await prestamoConUnMes();
    const antes = await obtenerPrestamo(db, prestamoId);

    const { prestamoNuevoId } = await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({ capital: desdeUnidades(6600, 'BOB') }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    const despues = await obtenerPrestamo(db, prestamoId);
    expect(despues!.estado).toBe('refinanciado');
    expect(despues!.motivoCierre).toContain(String(prestamoNuevoId));
    // Las condiciones originales quedan intactas: así se puede reconstruir qué se pactó.
    expect(despues!.condiciones.capital.centavos).toBe(antes!.condiciones.capital.centavos);
    expect(despues!.condiciones.tasa.puntosBasicos).toBe(antes!.condiciones.tasa.puntosBasicos);
  });

  it('el préstamo nuevo apunta al viejo', async () => {
    const { prestamoId } = await prestamoConUnMes();
    const { prestamoNuevoId } = await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({ capital: desdeUnidades(6600, 'BOB') }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    const nuevo = await obtenerPrestamo(db, prestamoNuevoId);
    expect(nuevo!.prestamoOrigenId).toBe(prestamoId);
    expect(nuevo!.estado).toBe('activo');
  });

  it('la deuda vieja queda "refinanciada": ni pagada ni condonada', async () => {
    const { prestamoId } = await prestamoConUnMes();
    await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({ capital: desdeUnidades(6600, 'BOB') }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    expect(obligaciones.every((o) => o.estado === 'refinanciada')).toBe(true);

    // Y dejan de contar como deuda: el saldo del préstamo viejo es cero.
    const deuda = resumenDeuda(obligaciones, 'BOB', PRIMER_VENCIMIENTO);
    expect(formatear(deuda.total)).toBe('Bs 0,00');
  });

  it('la deuda no se cuenta dos veces en la cartera', async () => {
    const { prestamoId } = await prestamoConUnMes();

    const antes = await totalesDeCartera(db, PRIMER_VENCIMIENTO);
    expect(formatear(antes[0].saldo)).toBe('Bs 6.600,00');

    await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({
        capital: desdeUnidades(6600, 'BOB'),
        fechaDesembolso: PRIMER_VENCIMIENTO,
        vencimientoCapital: dia('2027-05-09'),
      }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    const despues = await totalesDeCartera(db, PRIMER_VENCIMIENTO);
    expect(despues).toHaveLength(1);
    expect(formatear(despues[0].saldo)).toBe('Bs 6.600,00');
    expect(despues[0].prestamos).toBe(1);
  });

  it('no mueve la caja: el saldo trasladado nunca estuvo en el bolsillo', async () => {
    const { prestamoId } = await prestamoConUnMes();
    const antes = base.sqlite
      .prepare('SELECT SUM(monto_centavos) AS n FROM caja_movimientos')
      .get() as { n: number };

    await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({ capital: desdeUnidades(6600, 'BOB') }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    const despues = base.sqlite
      .prepare('SELECT SUM(monto_centavos) AS n FROM caja_movimientos')
      .get() as { n: number };
    expect(Number(despues.n)).toBe(Number(antes.n));
  });

  it('no cuenta el interés capitalizado como interés cobrado', async () => {
    const { clienteId, prestamoId } = await prestamoConUnMes();
    await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({ capital: desdeUnidades(6600, 'BOB') }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    // Los Bs 600 de interés pasaron a ser capital, pero nadie los pagó: la ganancia real
    // cobrada sigue en cero.
    const comportamiento = await comportamientoDeCliente(db, clienteId);
    expect(formatear(comportamiento[0].interesCobrado)).toBe('Bs 0,00');
    expect(comportamiento[0].refinanciaciones).toBe(1);
  });

  it('"le prestaste" no suma dos veces la deuda que se refinanció', async () => {
    const { clienteId, prestamoId } = await prestamoConUnMes();
    await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({ capital: desdeUnidades(6600, 'BOB') }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    const [bob] = await comportamientoDeCliente(db, clienteId);
    expect(formatear(bob.capitalEntregado)).toBe('Bs 6.000,00');
  });

  it('deja un asiento en el libro de cada préstamo', async () => {
    const { prestamoId } = await prestamoConUnMes();
    const { prestamoNuevoId } = await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({ capital: desdeUnidades(6600, 'BOB') }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    const asientos = base.sqlite
      .prepare(
        `SELECT prestamo_id, capital_centavos, detalle
           FROM movimientos WHERE tipo = 'refinanciacion' ORDER BY prestamo_id`,
      )
      .all() as { prestamo_id: number; capital_centavos: number; detalle: string }[];

    expect(asientos).toHaveLength(2);
    const sale = asientos.find((a) => a.prestamo_id === prestamoId)!;
    const entra = asientos.find((a) => a.prestamo_id === prestamoNuevoId)!;
    expect(sale.capital_centavos).toBe(-660_000);
    expect(entra.capital_centavos).toBe(660_000);
    expect(sale.detalle).toContain(String(prestamoNuevoId));
    expect(entra.detalle).toContain(String(prestamoId));
  });
});

describe('prestarle más plata', () => {
  it('suma el saldo viejo y la plata nueva, y solo la nueva sale de la caja', async () => {
    const { prestamoId } = await prestamoConUnMes();

    const resultado = await refinanciar(db, {
      prestamoId,
      // Debía 6.600 y se le entregan 2.000 más.
      condiciones: condiciones({
        capital: desdeUnidades(8600, 'BOB'),
        fechaDesembolso: PRIMER_VENCIMIENTO,
        vencimientoCapital: dia('2027-05-09'),
      }),
      efectivoEntregado: desdeUnidades(2000, 'BOB'),
      motivo: 'Necesitaba más para la mercadería',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    expect(formatear(resultado.saldoTrasladado)).toBe('Bs 6.600,00');
    expect(formatear(resultado.diferenciaAcordada)).toBe('Bs 0,00');

    const caja = base.sqlite
      .prepare(
        "SELECT monto_centavos FROM caja_movimientos WHERE tipo = 'desembolso' ORDER BY id DESC LIMIT 1",
      )
      .get() as { monto_centavos: number };
    expect(caja.monto_centavos).toBe(-200_000);
  });

  it('el interés del préstamo nuevo se calcula sobre el capital nuevo', async () => {
    const { prestamoId } = await prestamoConUnMes();
    const { prestamoNuevoId } = await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({
        capital: desdeUnidades(8600, 'BOB'),
        fechaDesembolso: PRIMER_VENCIMIENTO,
        vencimientoCapital: dia('2027-05-09'),
      }),
      efectivoEntregado: desdeUnidades(2000, 'BOB'),
      motivo: 'más plata',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    await devengar(db, { hoy: dia('2026-12-09'), ahora: AHORA });

    const obligaciones = await obligacionesDePrestamo(db, prestamoNuevoId);
    const interes = obligaciones.find((o) => o.tipo === 'interes');
    expect(formatear(interes!.interes)).toBe('Bs 860,00');
  });
});

describe('negociar el monto', () => {
  it('registra lo perdonado cuando el capital nuevo es menor que la deuda', async () => {
    const { prestamoId } = await prestamoConUnMes();

    const resultado = await refinanciar(db, {
      prestamoId,
      // Debía 6.600 y se acuerda arrancar de nuevo con 6.000.
      condiciones: condiciones({ capital: desdeUnidades(6000, 'BOB') }),
      motivo: 'Le perdonamos el interés del mes para que arranque de nuevo',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    expect(formatear(resultado.diferenciaAcordada)).toBe('-Bs 600,00');
  });
});

describe('validaciones', () => {
  it('no refinancia un préstamo que ya está cerrado', async () => {
    const { prestamoId } = await prestamoConUnMes();
    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(6600, 'BOB'),
      fecha: PRIMER_VENCIMIENTO,
      medio: 'efectivo',
      ahora: AHORA,
    });

    await expect(
      refinanciar(db, {
        prestamoId,
        condiciones: condiciones({ capital: desdeUnidades(1000, 'BOB') }),
        motivo: 'da igual',
        fecha: PRIMER_VENCIMIENTO,
        ahora: AHORA,
      }),
    ).rejects.toThrow(NoSePuedeRefinanciarError);
  });

  it('no refinancia dos veces el mismo préstamo', async () => {
    const { prestamoId } = await prestamoConUnMes();
    const params = {
      prestamoId,
      condiciones: condiciones({ capital: desdeUnidades(6600, 'BOB') }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    };

    await refinanciar(db, params);
    await expect(refinanciar(db, params)).rejects.toThrow(NoSePuedeRefinanciarError);
  });

  it('no cambia de moneda', async () => {
    const { prestamoId } = await prestamoConUnMes();
    await expect(
      refinanciar(db, {
        prestamoId,
        condiciones: condiciones({ capital: desdeUnidades(1000, 'USD') }),
        motivo: 'en dólares',
        fecha: PRIMER_VENCIMIENTO,
        ahora: AHORA,
      }),
    ).rejects.toThrow(MonedaIncompatibleError);
  });
});

describe('se puede seguir trabajando', () => {
  it('se le cobra al préstamo nuevo y el libro sigue cuadrando', async () => {
    const { prestamoId } = await prestamoConUnMes();
    const { prestamoNuevoId } = await refinanciar(db, {
      prestamoId,
      condiciones: condiciones({
        capital: desdeUnidades(6600, 'BOB'),
        fechaDesembolso: PRIMER_VENCIMIENTO,
        vencimientoCapital: dia('2027-05-09'),
      }),
      motivo: 'renovación',
      fecha: PRIMER_VENCIMIENTO,
      ahora: AHORA,
    });

    await devengar(db, { hoy: dia('2026-12-09'), ahora: AHORA });
    const resultado = await cobrar(db, {
      prestamoId: prestamoNuevoId,
      monto: desdeUnidades(660, 'BOB'),
      fecha: dia('2026-12-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });

    expect(formatear(resultado.desglose.interes)).toBe('Bs 660,00');
    expect((await verificar(db)).cuadra).toBe(true);
  });

  it('una cadena de tres refinanciaciones queda enlazada', async () => {
    const { clienteId, prestamoId } = await prestamoConUnMes();

    let actual = prestamoId;
    for (let vuelta = 1; vuelta <= 3; vuelta += 1) {
      const resultado = await refinanciar(db, {
        prestamoId: actual,
        condiciones: condiciones({ capital: desdeUnidades(6600 + vuelta, 'BOB') }),
        motivo: `renovación ${vuelta}`,
        fecha: PRIMER_VENCIMIENTO,
        ahora: AHORA,
      });
      actual = resultado.prestamoNuevoId;
    }

    const comportamiento = await comportamientoDeCliente(db, clienteId);
    expect(comportamiento[0].refinanciaciones).toBe(3);
    expect(comportamiento[0].prestamos).toBe(4);

    // Solo el último queda activo: la deuda nunca se duplica.
    const totales = await totalesDeCartera(db, PRIMER_VENCIMIENTO);
    expect(totales[0].prestamos).toBe(1);
  });
});
