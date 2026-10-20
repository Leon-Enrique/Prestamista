import { beforeEach, describe, expect, it } from 'vitest';

import { REGLAS_SIN_PENALIZACION, type Condiciones } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from '../servicios/cobrar';
import { desembolsar } from '../servicios/desembolsar';
import { revertirPago } from '../servicios/revertir';
import { crearBaseDePrueba, type BaseDePrueba } from './baseDePrueba';
import {
  actividadReciente,
  cobradoEnPeriodo,
  cobrosDetallados,
  deudaPorCliente,
} from './consultas';
import { crearCliente } from './repositorios/clientes';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;

let base: BaseDePrueba;
let prestamoId: number;

const condiciones: Condiciones = {
  capital: desdeUnidades(2000, 'BOB'),
  tasa: tasaDesdePorcentaje(10, 'mensual'),
  modalidad: 'cuota_fija',
  frecuencia: 'mensual',
  cantidadPeriodos: 3,
  fechaDesembolso: dia('2026-10-09'),
  vencimientoCapital: dia('2027-01-09'),
};

beforeEach(async () => {
  base = await crearBaseDePrueba();
  const clienteId = await crearCliente(base.db, { nombre: 'Ana', ci: '1', telefono: '7' }, AHORA);
  ({ prestamoId } = await desembolsar(base.db, {
    clienteId,
    condiciones,
    reglasMora: REGLAS_SIN_PENALIZACION,
    ahora: AHORA,
  }));
});

async function pagar(monto: number, fecha: string) {
  return cobrar(base.db, {
    prestamoId,
    monto: desdeUnidades(monto, 'BOB'),
    fecha: dia(fecha),
    medio: 'efectivo',
    ahora: AHORA,
  });
}

describe('cobradoEnPeriodo', () => {
  it('separa ganancia (interés) de recuperación de capital', async () => {
    await pagar(500, '2026-11-09');
    const [bob] = await cobradoEnPeriodo(base.db, dia('2026-11-01'), dia('2026-11-30'));
    expect(formatear(bob.interes)).toBe('Bs 200,00');
    expect(formatear(bob.capital)).toBe('Bs 300,00');
    expect(formatear(bob.penalizacion)).toBe('Bs 0,00');
    expect(bob.cantidadDePagos).toBe(1);
  });

  it('solo cuenta los pagos dentro del período', async () => {
    await pagar(500, '2026-11-09');
    await pagar(300, '2026-12-09');
    const [nov] = await cobradoEnPeriodo(base.db, dia('2026-11-01'), dia('2026-11-30'));
    expect(nov.cantidadDePagos).toBe(1);
    const fuera = await cobradoEnPeriodo(base.db, dia('2027-03-01'), dia('2027-03-31'));
    expect(fuera).toHaveLength(0);
  });

  it('un pago anulado deja de contar', async () => {
    const pago = await pagar(500, '2026-11-09');
    await revertirPago(base.db, {
      pagoId: pago.pagoId,
      motivo: 'Error',
      fecha: dia('2026-11-09'),
      ahora: AHORA,
    });
    const resultado = await cobradoEnPeriodo(base.db, dia('2026-11-01'), dia('2026-11-30'));
    expect(resultado).toHaveLength(0);
  });
});

describe('cobrosDetallados', () => {
  it('muestra cuánto fue interés en cada pago', async () => {
    await pagar(500, '2026-11-09');
    await pagar(300, '2026-12-09');
    const cobros = await cobrosDetallados(base.db, { prestamoId });
    expect(cobros).toHaveLength(2);
    // El más reciente primero: los 300 cubren lo que falta de la cuota 1 (104,23 de
    // capital) y siguen con el interés de la cuota 2 (139,58).
    expect(formatear(cobros[1].interes)).toBe('Bs 200,00');
    expect(formatear(cobros[1].capital)).toBe('Bs 300,00');
    expect(cobros[0].clienteNombre).toBe('Ana');
    const suma = cobros[0].interes.centavos + cobros[0].capital.centavos + cobros[0].penalizacion.centavos;
    expect(suma).toBe(cobros[0].monto.centavos);
  });

  it('en el reporte por período no incluye los anulados', async () => {
    const pago = await pagar(500, '2026-11-09');
    await revertirPago(base.db, {
      pagoId: pago.pagoId,
      motivo: 'Error',
      fecha: dia('2026-11-09'),
      ahora: AHORA,
    });
    const delPeriodo = await cobrosDetallados(base.db, {
      desde: dia('2026-11-01'),
      hasta: dia('2026-11-30'),
      sinAnulados: true,
    });
    expect(delPeriodo).toHaveLength(0);
    const delPrestamo = await cobrosDetallados(base.db, { prestamoId });
    expect(delPrestamo[0].anulado).toBe(true);
  });
});

describe('historial de pagos del cliente', () => {
  it('junta los pagos de todos sus préstamos, el más reciente primero', async () => {
    await pagar(500, '2026-11-09');
    const clienteId = (
      base.sqlite.prepare('SELECT cliente_id FROM prestamos WHERE id = ?').get(prestamoId) as {
        cliente_id: number;
      }
    ).cliente_id;
    const otro = await desembolsar(base.db, {
      clienteId,
      condiciones: { ...condiciones, capital: desdeUnidades(1000, 'BOB') },
      reglasMora: REGLAS_SIN_PENALIZACION,
      ahora: AHORA,
    });
    await cobrar(base.db, {
      prestamoId: otro.prestamoId,
      monto: desdeUnidades(100, 'BOB'),
      fecha: dia('2026-11-20'),
      medio: 'efectivo',
      ahora: AHORA,
    });

    const historial = await cobrosDetallados(base.db, { clienteId });
    expect(historial.map((c) => [c.fecha, formatear(c.monto)])).toEqual([
      ['2026-11-20', 'Bs 100,00'],
      ['2026-11-09', 'Bs 500,00'],
    ]);
  });
});

describe('actividad reciente', () => {
  it('mezcla préstamos entregados y cobros, lo último primero, sin anulados', async () => {
    await pagar(500, '2026-11-09');
    const anulado = await pagar(100, '2026-11-10');
    await revertirPago(base.db, {
      pagoId: anulado.pagoId,
      motivo: 'Error',
      fecha: dia('2026-11-10'),
      ahora: AHORA,
    });

    const actividad = await actividadReciente(base.db);
    expect(actividad.map((a) => [a.tipo, a.fecha, formatear(a.monto)])).toEqual([
      ['cobro', '2026-11-09', 'Bs 500,00'],
      ['prestamo', '2026-10-09', 'Bs 2.000,00'],
    ]);
  });
});

describe('deuda por cliente', () => {
  it('suma lo que debe en sus préstamos activos y marca si está atrasado', async () => {
    const clienteId = (
      base.sqlite.prepare('SELECT cliente_id FROM prestamos WHERE id = ?').get(prestamoId) as {
        cliente_id: number;
      }
    ).cliente_id;

    const alDia = await deudaPorCliente(base.db, dia('2026-10-20'));
    expect(alDia.get(clienteId)!.saldos.map((s) => formatear(s))).toEqual(['Bs 2.412,69']);
    expect(alDia.get(clienteId)!.atrasado).toBe(false);

    const despues = await deudaPorCliente(base.db, dia('2026-11-20'));
    expect(despues.get(clienteId)!.atrasado).toBe(true);
  });
});
