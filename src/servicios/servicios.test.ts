/**
 * Pruebas de extremo a extremo: desembolsar → devengar → cobrar, con SQL real.
 *
 * Reproducen el caso concreto del usuario (Bs 6.000 al 10% mensual, interés cobrado cada mes
 * y capital aparte) y verifican lo que el checklist de `pre-release` pide comprobar antes de
 * usar la app con plata de verdad.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import type { EjecutorSQL } from '../datos/ejecutor';
import { crearCliente } from '../datos/repositorios/clientes';
import { obligacionesDePrestamo } from '../datos/repositorios/obligaciones';
import { obtenerPrestamo } from '../datos/repositorios/prestamos';
import { resumenDeuda } from '../dominio/obligaciones';
import type { Condiciones } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { PrestamoNoActivoError } from '../nucleo/errores';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from './cobrar';
import { desembolsar } from './desembolsar';
import { devengar } from './devengar';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;

const DESEMBOLSO = dia('2026-10-09');
const PRIMER_VENCIMIENTO = dia('2026-11-09');
const DIEZ_DIAS_TARDE = dia('2026-11-19');
const SEIS_MESES = dia('2027-04-09');

let base: BaseDePrueba;
let db: EjecutorSQL;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  db = base.db;
});

async function nuevoCliente(nombre = 'Juan Pérez'): Promise<number> {
  return crearCliente(db, { nombre, ci: '1234567', telefono: '70000000' }, AHORA);
}

/** Bs 6.000 al 10% mensual, solo interés, capital a 6 meses. El caso real del usuario. */
function condicionesSoloInteres(overrides: Partial<Condiciones> = {}): Condiciones {
  return {
    capital: desdeUnidades(6000, 'BOB'),
    tasa: tasaDesdePorcentaje(10, 'mensual'),
    modalidad: 'solo_interes',
    frecuencia: 'mensual',
    cantidadPeriodos: null,
    fechaDesembolso: DESEMBOLSO,
    vencimientoCapital: SEIS_MESES,
    ...overrides,
  };
}

async function deudaDe(prestamoId: number, hasta = SEIS_MESES) {
  const obligaciones = await obligacionesDePrestamo(db, prestamoId);
  return resumenDeuda(obligaciones, 'BOB', hasta);
}

describe('desembolsar', () => {
  it('un préstamo de solo interés arranca con la obligación de capital y nada más', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId, obligacionesCreadas, resumen } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });

    expect(obligacionesCreadas).toBe(1);
    expect(resumen).toBeNull();

    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    expect(obligaciones).toHaveLength(1);
    expect(obligaciones[0].tipo).toBe('capital');
    expect(formatear(obligaciones[0].capital)).toBe('Bs 6.000,00');
    expect(obligaciones[0].vencimiento).toBe('2027-04-09');
  });

  it('un préstamo con cuotas guarda todo su cronograma de una vez', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId, resumen } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres({
        capital: desdeUnidades(1000, 'BOB'),
        tasa: tasaDesdePorcentaje(5, 'mensual'),
        modalidad: 'cuota_fija',
        cantidadPeriodos: 4,
      }),
      ahora: AHORA,
    });

    expect(formatear(resumen!.totalInteres)).toBe('Bs 128,05');

    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    expect(obligaciones).toHaveLength(4);
    expect(obligaciones.every((o) => o.tipo === 'cuota')).toBe(true);
  });

  it('el desembolso sale de la caja', async () => {
    const clienteId = await nuevoCliente();
    await desembolsar(db, { clienteId, condiciones: condicionesSoloInteres(), ahora: AHORA });

    const fila = base.sqlite
      .prepare("SELECT tipo, monto_centavos FROM caja_movimientos WHERE tipo = 'desembolso'")
      .get() as { tipo: string; monto_centavos: number };

    // Negativo: la plata se fue del bolsillo y está colocada.
    expect(fila.monto_centavos).toBe(-600_000);
  });
});

describe('devengar interés mensual', () => {
  it('al cumplirse el primer mes aparece el interés de Bs 600', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });

    const resumen = await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
    expect(resumen.interesesCreados).toBe(1);

    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    const interes = obligaciones.filter((o) => o.tipo === 'interes');
    expect(interes).toHaveLength(1);
    expect(formatear(interes[0].interes)).toBe('Bs 600,00');
    expect(interes[0].vencimiento).toBe('2026-11-09');
  });

  it('no devenga nada el día antes del vencimiento: no existe el interés de un mes que no pasó', async () => {
    const clienteId = await nuevoCliente();
    await desembolsar(db, { clienteId, condiciones: condicionesSoloInteres(), ahora: AHORA });

    const resumen = await devengar(db, { hoy: dia('2026-11-08'), ahora: AHORA });
    expect(resumen.interesesCreados).toBe(0);
  });

  it('correr el devengo dos veces no duplica la deuda', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });

    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
    const segunda = await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
    const tercera = await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });

    expect(segunda.interesesCreados).toBe(0);
    expect(tercera.interesesCreados).toBe(0);

    const deuda = await deudaDe(prestamoId, PRIMER_VENCIMIENTO);
    expect(formatear(deuda.interes)).toBe('Bs 600,00');
  });

  it('a los seis meses el interés es Bs 3.600 y el capital sigue siendo Bs 6.000', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });

    await devengar(db, { hoy: SEIS_MESES, ahora: AHORA });
    const deuda = await deudaDe(prestamoId);

    // Seis intereses de Bs 600, no un saldo compuesto. Capitalizando serían Bs 4.629 de
    // interés en vez de Bs 3.600 — el interés impago no se suma al capital.
    expect(formatear(deuda.interes)).toBe('Bs 3.600,00');
    expect(formatear(deuda.capital)).toBe('Bs 6.000,00');
  });

  it('si el capital ya se devolvió, el interés deja de correr aunque queden intereses impagos', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });
    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });

    // Imputa los Bs 6.000 solo a capital, así el préstamo queda activo con el interés del
    // primer mes impago. Es el escenario que prueba de verdad el corte del devengo.
    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(6000, 'BOB'),
      fecha: PRIMER_VENCIMIENTO,
      medio: 'efectivo',
      componentes: ['capital'],
      ahora: AHORA,
    });

    const prestamo = await obtenerPrestamo(db, prestamoId);
    expect(prestamo!.estado).toBe('activo');

    const resumen = await devengar(db, { hoy: SEIS_MESES, ahora: AHORA });
    expect(resumen.interesesCreados).toBe(0);

    const deuda = await deudaDe(prestamoId);
    expect(formatear(deuda.capital)).toBe('Bs 0,00');
    expect(formatear(deuda.interes)).toBe('Bs 600,00');
  });
});

describe('devengar mora', () => {
  it('diez días tarde sobre Bs 600 son Bs 21 de mora', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });

    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
    const resumen = await devengar(db, { hoy: DIEZ_DIAS_TARDE, ahora: AHORA });

    expect(resumen.morasCreadas).toBe(1);
    const deuda = await deudaDe(prestamoId, DIEZ_DIAS_TARDE);
    expect(formatear(deuda.mora)).toBe('Bs 21,00');
  });

  it('la mora es una sola obligación que crece, no una por día', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });

    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
    await devengar(db, { hoy: DIEZ_DIAS_TARDE, ahora: AHORA });
    const siguiente = await devengar(db, { hoy: dia('2026-11-20'), ahora: AHORA });

    expect(siguiente.morasCreadas).toBe(0);
    expect(siguiente.morasAumentadas).toBe(1);

    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    const moras = obligaciones.filter((o) => o.tipo === 'mora');
    expect(moras).toHaveLength(1);
    expect(formatear(moras[0].mora)).toBe('Bs 24,00');
  });

  it('dentro de los días de gracia no hay mora', async () => {
    const clienteId = await nuevoCliente();
    await desembolsar(db, { clienteId, condiciones: condicionesSoloInteres(), ahora: AHORA });

    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
    const resumen = await devengar(db, { hoy: dia('2026-11-12'), ahora: AHORA });
    expect(resumen.morasCreadas).toBe(0);
  });

  it('al capital de un préstamo de solo interés no se le cobra mora: ya paga interés corriente', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });

    // Un mes después del vencimiento del capital, con todo impago.
    await devengar(db, { hoy: dia('2027-05-09'), ahora: AHORA });

    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    const capital = obligaciones.find((o) => o.tipo === 'capital')!;
    const moraDelCapital = obligaciones.filter(
      (o) => o.tipo === 'mora' && o.obligacionOrigenId === capital.id,
    );
    expect(moraDelCapital).toHaveLength(0);

    // Pero sí hay mora de los intereses vencidos.
    expect(obligaciones.some((o) => o.tipo === 'mora')).toBe(true);
  });
});

describe('cobrar', () => {
  it('el pago de Bs 400: Bs 21 a mora, Bs 379 a interés, capital intacto', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });

    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
    await devengar(db, { hoy: DIEZ_DIAS_TARDE, ahora: AHORA });

    const resultado = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });

    expect(formatear(resultado.desglose.mora)).toBe('Bs 21,00');
    expect(formatear(resultado.desglose.interes)).toBe('Bs 379,00');
    expect(formatear(resultado.desglose.capital)).toBe('Bs 0,00');
    expect(resultado.prestamoCerrado).toBe(false);

    const deuda = await deudaDe(prestamoId, DIEZ_DIAS_TARDE);
    expect(formatear(deuda.capital)).toBe('Bs 6.000,00');
    expect(formatear(deuda.interes)).toBe('Bs 221,00');
    expect(formatear(deuda.mora)).toBe('Bs 0,00');
  });

  it('deja el rastro completo: pago, imputaciones, asiento y caja', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });
    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });

    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(600, 'BOB'),
      fecha: PRIMER_VENCIMIENTO,
      medio: 'efectivo',
      nota: 'pagó en la oficina',
      ahora: AHORA,
    });

    const imputaciones = base.sqlite
      .prepare('SELECT componente, monto_centavos FROM imputaciones WHERE pago_id = ?')
      .all(pagoId) as { componente: string; monto_centavos: number }[];
    expect(imputaciones).toEqual([{ componente: 'interes', monto_centavos: 60_000 }]);

    const asiento = base.sqlite
      .prepare("SELECT interes_centavos, autor FROM movimientos WHERE tipo = 'pago'")
      .get() as { interes_centavos: number; autor: string };
    expect(asiento.interes_centavos).toBe(60_000);
    expect(asiento.autor).toBe('dueño');

    const caja = base.sqlite
      .prepare("SELECT monto_centavos FROM caja_movimientos WHERE tipo = 'cobro'")
      .get() as { monto_centavos: number };
    expect(caja.monto_centavos).toBe(60_000);
  });

  it('una transferencia no entra a la caja, pero sí al libro', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });
    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });

    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(600, 'BOB'),
      fecha: PRIMER_VENCIMIENTO,
      medio: 'transferencia',
      ahora: AHORA,
    });

    const cobrosEnCaja = base.sqlite
      .prepare("SELECT COUNT(*) AS n FROM caja_movimientos WHERE tipo = 'cobro'")
      .get() as { n: number };
    expect(Number(cobrosEnCaja.n)).toBe(0);

    const pagosEnLibro = base.sqlite
      .prepare("SELECT COUNT(*) AS n FROM movimientos WHERE tipo = 'pago'")
      .get() as { n: number };
    expect(Number(pagosEnLibro.n)).toBe(1);
  });

  it('cuando se cobra todo, el préstamo se cierra y no admite más cobros', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });
    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });

    const resultado = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(6600, 'BOB'),
      fecha: PRIMER_VENCIMIENTO,
      medio: 'efectivo',
      ahora: AHORA,
    });

    expect(resultado.prestamoCerrado).toBe(true);
    expect(formatear(resultado.sobrante)).toBe('Bs 0,00');

    const prestamo = await obtenerPrestamo(db, prestamoId);
    expect(prestamo!.estado).toBe('pagado');

    await expect(
      cobrar(db, {
        prestamoId,
        monto: desdeUnidades(100, 'BOB'),
        fecha: PRIMER_VENCIMIENTO,
        medio: 'efectivo',
        ahora: AHORA,
      }),
    ).rejects.toThrow(PrestamoNoActivoError);
  });

  it('lo que sobra queda registrado como saldo a favor, no como deuda inventada', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres(),
      ahora: AHORA,
    });
    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });

    const resultado = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(7000, 'BOB'),
      fecha: PRIMER_VENCIMIENTO,
      medio: 'efectivo',
      ahora: AHORA,
    });

    expect(formatear(resultado.aplicado)).toBe('Bs 6.600,00');
    expect(formatear(resultado.sobrante)).toBe('Bs 400,00');

    const pago = base.sqlite
      .prepare('SELECT sobrante_centavos FROM pagos WHERE id = ?')
      .get(resultado.pagoId) as { sobrante_centavos: number };
    expect(pago.sobrante_centavos).toBe(40_000);
  });

  it('un pago sobre cuotas liquida las más viejas y deja una a medias', async () => {
    const clienteId = await nuevoCliente();
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condicionesSoloInteres({
        capital: desdeUnidades(1000, 'BOB'),
        tasa: tasaDesdePorcentaje(5, 'mensual'),
        modalidad: 'interes_flat',
        cantidadPeriodos: 4,
      }),
      ahora: AHORA,
    });

    // Cuotas de Bs 300. Bs 750 cubre dos y media.
    const resultado = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(750, 'BOB'),
      fecha: dia('2027-03-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });

    expect(formatear(resultado.aplicado)).toBe('Bs 750,00');

    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    expect(obligaciones.map((o) => o.estado)).toEqual([
      'pagada',
      'pagada',
      'parcial',
      'pendiente',
    ]);
  });
});
