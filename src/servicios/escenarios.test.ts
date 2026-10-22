/**
 * Escenarios de punta a punta con los números del ejemplo de Bs 2.000 al 10% mensual a
 * 3 meses, contra SQL real. Verifican lo que el usuario verá en pantalla: el cronograma de
 * cada modalidad, el reparto de un pago parcial, el reverso y la penalización opcional.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import type { EjecutorSQL } from '../datos/ejecutor';
import { crearCliente } from '../datos/repositorios/clientes';
import { obligacionesDePrestamo } from '../datos/repositorios/obligaciones';
import { obtenerPrestamo } from '../datos/repositorios/prestamos';
import { verificar } from '../datos/verificacion';
import { resumenDeuda } from '../dominio/obligaciones';
import { proximoPago } from '../dominio/proximo-pago';
import {
  REGLAS_MORA_POR_DEFECTO,
  REGLAS_SIN_PENALIZACION,
  type Condiciones,
  type Modalidad,
} from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from './cobrar';
import { desembolsar } from './desembolsar';
import { devengar } from './devengar';
import { revertirPago } from './revertir';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;
const DESEMBOLSO = dia('2026-10-09');

let base: BaseDePrueba;
let db: EjecutorSQL;
let clienteId: number;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  db = base.db;
  clienteId = await crearCliente(db, { nombre: 'Juan Pérez', ci: '1', telefono: '7' }, AHORA);
});

function condiciones(modalidad: Modalidad): Condiciones {
  return {
    capital: desdeUnidades(2000, 'BOB'),
    tasa: tasaDesdePorcentaje(10, 'mensual'),
    modalidad,
    frecuencia: 'mensual',
    cantidadPeriodos: modalidad === 'solo_interes' ? null : 3,
    fechaDesembolso: DESEMBOLSO,
    vencimientoCapital: dia('2027-01-09'),
  };
}

describe('cronograma de cada modalidad (Bs 2.000, 10% mensual, 3 meses)', () => {
  it('cuota fija: Bs 804,23 por mes, Bs 2.412,69 en total', async () => {
    const { prestamoId, resumen } = await desembolsar(db, {
      clienteId,
      condiciones: condiciones('cuota_fija'),
      ahora: AHORA,
    });
    expect(formatear(resumen!.cuotaMaxima)).toBe('Bs 804,23');
    expect(formatear(resumen!.totalAPagar)).toBe('Bs 2.412,69');
    expect(formatear(resumen!.totalInteres)).toBe('Bs 412,69');
    const cuotas = (await obligacionesDePrestamo(db, prestamoId)).filter(
      (o) => o.tipo === 'cuota',
    );
    expect(cuotas).toHaveLength(3);
  });

  it('capital fijo: cuotas de unos 866 a 733 y Bs 400 de interés', async () => {
    const { resumen } = await desembolsar(db, {
      clienteId,
      condiciones: condiciones('capital_fijo'),
      ahora: AHORA,
    });
    expect(formatear(resumen!.cuotaMaxima)).toBe('Bs 866,66');
    expect(formatear(resumen!.cuotaMinima)).toBe('Bs 733,35');
    expect(formatear(resumen!.totalInteres)).toBe('Bs 400,00');
  });

  it('interés sobre el monto prestado: unos Bs 866,67 por mes (el centavo sobrante va a la última), Bs 2.600 en total', async () => {
    const { resumen } = await desembolsar(db, {
      clienteId,
      condiciones: condiciones('interes_flat'),
      ahora: AHORA,
    });
    expect(formatear(resumen!.cuotaMaxima)).toBe('Bs 866,68');
    expect(formatear(resumen!.totalAPagar)).toBe('Bs 2.600,00');
  });

  it('pago único: Bs 2.600 en total', async () => {
    const { resumen } = await desembolsar(db, {
      clienteId,
      condiciones: condiciones('pago_unico'),
      ahora: AHORA,
    });
    expect(formatear(resumen!.totalAPagar)).toBe('Bs 2.600,00');
  });

  it('solo interés sin fecha: Bs 200 por mes y el capital sin vencimiento', async () => {
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: { ...condiciones('solo_interes'), vencimientoCapital: null },
      ahora: AHORA,
    });
    await devengar(db, { hoy: dia('2026-11-09'), ahora: AHORA });
    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    const interes = obligaciones.find((o) => o.tipo === 'interes')!;
    expect(formatear(interes.interes)).toBe('Bs 200,00');
    expect(obligaciones.find((o) => o.tipo === 'capital')!.vencimiento).toBeNull();
  });
});

describe('pagos de lo que el cliente tiene', () => {
  async function cuotaFija() {
    return desembolsar(db, {
      clienteId,
      condiciones: condiciones('cuota_fija'),
      reglasMora: REGLAS_SIN_PENALIZACION,
      ahora: AHORA,
    });
  }

  it('Bs 500 en la primera cuota: 200 de interés y 300 de capital', async () => {
    const { prestamoId } = await cuotaFija();
    const r = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(500, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect(formatear(r.desglose.interes)).toBe('Bs 200,00');
    expect(formatear(r.desglose.capital)).toBe('Bs 300,00');
    expect(formatear(r.sobrante)).toBe('Bs 0,00');
    expect((await verificar(db)).cuadra).toBe(true);
  });

  it('Bs 1.000: paga la cuota 1 completa y sigue con la 2', async () => {
    const { prestamoId } = await cuotaFija();
    const r = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(1000, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    const cuotas = (await obligacionesDePrestamo(db, prestamoId)).filter(
      (o) => o.tipo === 'cuota',
    );
    expect(cuotas[0].estado).toBe('pagada');
    expect(cuotas[1].estado).not.toBe('pagada');
    expect(formatear(r.aplicado)).toBe('Bs 1.000,00');
  });

  it('anular el cobro deja la deuda como estaba', async () => {
    const { prestamoId } = await cuotaFija();
    const hasta = dia('2027-02-09');
    const antes = resumenDeuda(await obligacionesDePrestamo(db, prestamoId), 'BOB', hasta);
    const r = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(500, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    await revertirPago(db, {
      pagoId: r.pagoId,
      motivo: 'Monto mal anotado',
      fecha: dia('2026-11-09'),
      ahora: AHORA,
    });
    const despues = resumenDeuda(await obligacionesDePrestamo(db, prestamoId), 'BOB', hasta);
    expect(formatear(despues.total)).toBe(formatear(antes.total));
    expect((await verificar(db)).cuadra).toBe(true);
  });
});

describe('penalización por atraso', () => {
  async function atrasado(reglasMora: typeof REGLAS_SIN_PENALIZACION) {
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condiciones('cuota_fija'),
      reglasMora,
      ahora: AHORA,
    });
    const resumen = await devengar(db, { hoy: dia('2027-05-09'), ahora: AHORA });
    const moras = (await obligacionesDePrestamo(db, prestamoId)).filter((o) => o.tipo === 'mora');
    return { resumen, moras };
  }

  it('sin penalización no se genera nada, por mucho que se atrase', async () => {
    const { resumen, moras } = await atrasado(REGLAS_SIN_PENALIZACION);
    expect(resumen.morasCreadas).toBe(0);
    expect(moras).toHaveLength(0);
  });

  it('con penalización se genera, y respeta el techo del 20%', async () => {
    const { moras } = await atrasado(REGLAS_MORA_POR_DEFECTO);
    expect(moras.length).toBeGreaterThan(0);
    const cuotaEnCentavos = 80_423;
    for (const m of moras) {
      expect(m.mora.centavos).toBeLessThanOrEqual(Math.round(cuotaEnCentavos * 0.2) + 1);
    }
  });
});

describe('solo interés con pagos variables', () => {
  async function soloInteres() {
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: { ...condiciones('solo_interes'), vencimientoCapital: null },
      reglasMora: REGLAS_SIN_PENALIZACION,
      ahora: AHORA,
    });
    return prestamoId;
  }

  async function pagar(prestamoId: number, monto: number, fecha: string) {
    await devengar(db, { hoy: dia(fecha), ahora: AHORA });
    return cobrar(db, {
      prestamoId,
      monto: desdeUnidades(monto, 'BOB'),
      fecha: dia(fecha),
      medio: 'efectivo',
      ahora: AHORA,
    });
  }

  it('un mes solo interés, al siguiente interés más capital: el interés baja', async () => {
    const prestamoId = await soloInteres();

    const mes1 = await pagar(prestamoId, 200, '2026-11-09');
    expect(formatear(mes1.desglose.interes)).toBe('Bs 200,00');
    expect(formatear(mes1.desglose.capital)).toBe('Bs 0,00');

    const mes2 = await pagar(prestamoId, 700, '2026-12-09');
    expect(formatear(mes2.desglose.interes)).toBe('Bs 200,00');
    expect(formatear(mes2.desglose.capital)).toBe('Bs 500,00');

    // El capital que queda es 1.500, así que el interés del mes 3 es 150.
    await devengar(db, { hoy: dia('2027-01-09'), ahora: AHORA });
    const intereses = (await obligacionesDePrestamo(db, prestamoId)).filter(
      (o) => o.tipo === 'interes',
    );
    expect(formatear(intereses[intereses.length - 1].interes)).toBe('Bs 150,00');
    expect((await verificar(db)).cuadra).toBe(true);
  });

  it('un mes sin pagar nada: el interés queda debiéndose y no se suma al capital', async () => {
    const prestamoId = await soloInteres();
    await devengar(db, { hoy: dia('2026-11-09'), ahora: AHORA });
    await devengar(db, { hoy: dia('2026-12-09'), ahora: AHORA });

    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    const intereses = obligaciones.filter((o) => o.tipo === 'interes');
    expect(intereses.map((o) => formatear(o.interes))).toEqual(['Bs 200,00', 'Bs 200,00']);

    // Paga 600: cubre los dos intereses atrasados y el resto va a capital.
    const r = await pagar(prestamoId, 600, '2026-12-09');
    expect(formatear(r.desglose.interes)).toBe('Bs 400,00');
    expect(formatear(r.desglose.capital)).toBe('Bs 200,00');
  });
});

describe('préstamo cargado con fecha de entrega pasada', () => {
  it('al entregar hace 2 meses, el interés de esos 2 meses ya aparece', async () => {
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: {
        ...condiciones('solo_interes'),
        fechaDesembolso: dia('2026-08-20'),
        vencimientoCapital: null,
      },
      reglasMora: REGLAS_SIN_PENALIZACION,
      ahora: AHORA,
    });
    await devengar(db, { hoy: dia('2026-10-20'), ahora: AHORA });
    const intereses = (await obligacionesDePrestamo(db, prestamoId)).filter(
      (o) => o.tipo === 'interes',
    );
    expect(intereses.map((o) => formatear(o.interes))).toEqual(['Bs 200,00', 'Bs 200,00']);
    expect((await verificar(db)).cuadra).toBe(true);
  });
});

describe('10% del préstamo repartido en cuotas semanales', () => {
  it('Bs 6.000, 4 semanas: Bs 1.650 por semana y Bs 600 de interés', async () => {
    // La pantalla convierte "10% del préstamo" en 10 / 4 = 2,5% por período.
    const { resumen } = await desembolsar(db, {
      clienteId,
      condiciones: {
        capital: desdeUnidades(6000, 'BOB'),
        tasa: tasaDesdePorcentaje(10 / 4, 'semanal'),
        modalidad: 'interes_flat',
        frecuencia: 'semanal',
        cantidadPeriodos: 4,
        fechaDesembolso: DESEMBOLSO,
        vencimientoCapital: dia('2026-11-06'),
      },
      ahora: AHORA,
    });
    expect(formatear(resumen!.cuotaMaxima)).toBe('Bs 1.650,00');
    expect(formatear(resumen!.totalInteres)).toBe('Bs 600,00');
    expect(formatear(resumen!.totalAPagar)).toBe('Bs 6.600,00');
  });
});

describe('10% mensual en cuotas semanales: 4 semanas son un mes', () => {
  it('Bs 800 al 10% mensual en 4 semanas: Bs 80 de interés', async () => {
    const { resumen } = await desembolsar(db, {
      clienteId,
      condiciones: {
        capital: desdeUnidades(800, 'BOB'),
        tasa: tasaDesdePorcentaje(10, 'mensual'),
        modalidad: 'interes_flat',
        frecuencia: 'semanal',
        cantidadPeriodos: 4,
        fechaDesembolso: DESEMBOLSO,
        vencimientoCapital: dia('2026-11-06'),
      },
      ahora: AHORA,
    });
    expect(formatear(resumen!.totalInteres)).toBe('Bs 80,00');
    expect(formatear(resumen!.totalAPagar)).toBe('Bs 880,00');
  });
});

describe('cobro con el reparto elegido', () => {
  const bs = (n: number) => desdeUnidades(n, 'BOB');

  async function pagaComoPuede() {
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: { ...condiciones('solo_interes'), vencimientoCapital: null },
      reglasMora: REGLAS_SIN_PENALIZACION,
      ahora: AHORA,
    });
    await devengar(db, { hoy: dia('2026-11-09'), ahora: AHORA });
    return prestamoId;
  }

  it('solo capital: el interés queda pendiente y el próximo interés baja', async () => {
    const prestamoId = await pagaComoPuede();
    const r = await cobrar(db, {
      prestamoId,
      monto: bs(500),
      reparto: { interes: bs(0), capital: bs(500), mora: bs(0) },
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect(formatear(r.desglose.capital)).toBe('Bs 500,00');
    expect(formatear(r.desglose.interes)).toBe('Bs 0,00');

    const deuda = resumenDeuda(await obligacionesDePrestamo(db, prestamoId), 'BOB', dia('2026-11-09'));
    expect(formatear(deuda.interes)).toBe('Bs 200,00');
    expect(formatear(deuda.capital)).toBe('Bs 1.500,00');

    await devengar(db, { hoy: dia('2026-12-09'), ahora: AHORA });
    const intereses = (await obligacionesDePrestamo(db, prestamoId)).filter((o) => o.tipo === 'interes');
    expect(formatear(intereses[intereses.length - 1].interes)).toBe('Bs 150,00');
    expect((await verificar(db)).cuadra).toBe(true);
  });

  it('al día siguiente, lo que paga va todo a capital sin elegir nada', async () => {
    const prestamoId = await pagaComoPuede();
    await cobrar(db, { prestamoId, monto: bs(200), fecha: dia('2026-11-09'), medio: 'efectivo', ahora: AHORA });
    const manana = await cobrar(db, {
      prestamoId,
      monto: bs(300),
      fecha: dia('2026-11-10'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect(formatear(manana.desglose.capital)).toBe('Bs 300,00');
    expect(formatear(manana.desglose.interes)).toBe('Bs 0,00');
  });

  it('el reparto tiene que sumar el monto del pago', async () => {
    const prestamoId = await pagaComoPuede();
    await expect(
      cobrar(db, {
        prestamoId,
        monto: bs(600),
        reparto: { interes: bs(100), capital: bs(400), mora: bs(0) },
        fecha: dia('2026-11-09'),
        medio: 'efectivo',
        ahora: AHORA,
      }),
    ).rejects.toThrow(/suma Bs 500,00/);
  });

  it('anular un cobro con reparto elegido deja todo como estaba', async () => {
    const prestamoId = await pagaComoPuede();
    const antes = resumenDeuda(await obligacionesDePrestamo(db, prestamoId), 'BOB', dia('2026-11-09'));
    const r = await cobrar(db, {
      prestamoId,
      monto: bs(700),
      reparto: { interes: bs(100), capital: bs(600), mora: bs(0) },
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    await revertirPago(db, { pagoId: r.pagoId, motivo: 'Error', fecha: dia('2026-11-09'), ahora: AHORA });
    const despues = resumenDeuda(await obligacionesDePrestamo(db, prestamoId), 'BOB', dia('2026-11-09'));
    expect(formatear(despues.total)).toBe(formatear(antes.total));
    expect((await verificar(db)).cuadra).toBe(true);
  });
});

describe('próximo pago', () => {
  it('paga como puede: el próximo interés es el 10% del capital que debe hoy', async () => {
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: { ...condiciones('solo_interes'), vencimientoCapital: null },
      reglasMora: REGLAS_SIN_PENALIZACION,
      ahora: AHORA,
    });
    const ver = async (hoy: string) => {
      const prestamo = (await obtenerPrestamo(db, prestamoId))!;
      return proximoPago(prestamo.condiciones, await obligacionesDePrestamo(db, prestamoId), dia(hoy));
    };

    const antes = (await ver('2026-10-20'))!;
    expect(antes.fecha).toBe('2026-11-09');
    expect(formatear(antes.interes)).toBe('Bs 200,00');

    // Paga el interés del mes y 1.000 de capital: el próximo interés baja a 100.
    await devengar(db, { hoy: dia('2026-11-09'), ahora: AHORA });
    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(1200, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    const despues = (await ver('2026-11-09'))!;
    expect(despues.fecha).toBe('2026-12-09');
    expect(formatear(despues.interes)).toBe('Bs 100,00');
  });

  it('con cuotas: la próxima cuota sin pagar, con su interés y su capital', async () => {
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condiciones('interes_flat'),
      reglasMora: REGLAS_SIN_PENALIZACION,
      ahora: AHORA,
    });
    const prestamo = (await obtenerPrestamo(db, prestamoId))!;
    const p = proximoPago(prestamo.condiciones, await obligacionesDePrestamo(db, prestamoId), dia('2026-10-20'))!;
    expect(p.fecha).toBe('2026-11-09');
    expect(formatear(p.interes)).toBe('Bs 200,00');
    expect(formatear(p.total)).toBe('Bs 866,66');
  });
});
