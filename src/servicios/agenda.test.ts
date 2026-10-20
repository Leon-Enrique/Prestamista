import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import { crearCliente } from '../datos/repositorios/clientes';
import { REGLAS_SIN_PENALIZACION, type Condiciones } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { agendaDeCobros } from './agenda';
import { cobrar } from './cobrar';
import { desembolsar } from './desembolsar';
import { devengar } from './devengar';

const AHORA = '2026-10-20T17:00:00.000Z' as Instante;

let base: BaseDePrueba;
let clienteId: number;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  clienteId = await crearCliente(base.db, { nombre: 'Ana', ci: '1', telefono: '7' }, AHORA);
});

async function prestar(c: Partial<Condiciones>) {
  const { prestamoId } = await desembolsar(base.db, {
    clienteId,
    condiciones: {
      capital: desdeUnidades(6000, 'BOB'),
      tasa: tasaDesdePorcentaje(10, 'mensual'),
      modalidad: 'interes_flat',
      frecuencia: 'semanal',
      cantidadPeriodos: 4,
      fechaDesembolso: dia('2026-10-20'),
      vencimientoCapital: dia('2026-11-17'),
      ...c,
    },
    reglasMora: REGLAS_SIN_PENALIZACION,
    ahora: AHORA,
  });
  return prestamoId;
}

describe('agenda de cobros', () => {
  it('muestra la cuota que vence esta semana', async () => {
    await prestar({});
    const agenda = await agendaDeCobros(base.db, {
      hoy: dia('2026-10-21'),
      hasta: dia('2026-10-27'),
    });
    expect(agenda).toHaveLength(1);
    expect(agenda[0].fecha).toBe('2026-10-27');
    expect(formatear(agenda[0].monto)).toBe('Bs 1.650,00');
    expect(agenda[0].atrasado).toBe(false);
    expect(agenda[0].clienteNombre).toBe('Ana');
  });

  it('suma lo atrasado y lo marca', async () => {
    await prestar({});
    const agenda = await agendaDeCobros(base.db, {
      hoy: dia('2026-10-30'),
      hasta: dia('2026-11-05'),
    });
    // Cuota del 27 (atrasada) y cuota del 3 de noviembre.
    expect(formatear(agenda[0].monto)).toBe('Bs 3.300,00');
    expect(agenda[0].fecha).toBe('2026-10-27');
    expect(agenda[0].atrasado).toBe(true);
  });

  it('no muestra lo que ya está pagado', async () => {
    const prestamoId = await prestar({});
    await cobrar(base.db, {
      prestamoId,
      monto: desdeUnidades(1650, 'BOB'),
      fecha: dia('2026-10-21'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    const agenda = await agendaDeCobros(base.db, {
      hoy: dia('2026-10-21'),
      hasta: dia('2026-10-27'),
    });
    expect(agenda).toHaveLength(0);
  });

  it('en solo interés anticipa el interés que va a vencer', async () => {
    await prestar({
      modalidad: 'solo_interes',
      frecuencia: 'mensual',
      cantidadPeriodos: null,
      vencimientoCapital: null,
      fechaDesembolso: dia('2026-09-25'),
    });
    await devengar(base.db, { hoy: dia('2026-10-21'), ahora: AHORA });

    const agenda = await agendaDeCobros(base.db, {
      hoy: dia('2026-10-21'),
      hasta: dia('2026-10-27'),
    });
    expect(agenda).toHaveLength(1);
    expect(agenda[0].fecha).toBe('2026-10-25');
    expect(formatear(agenda[0].monto)).toBe('Bs 600,00');
  });

  it('en solo interés no cuenta dos veces un interés ya generado', async () => {
    await prestar({
      modalidad: 'solo_interes',
      frecuencia: 'mensual',
      cantidadPeriodos: null,
      vencimientoCapital: null,
      fechaDesembolso: dia('2026-09-25'),
    });
    await devengar(base.db, { hoy: dia('2026-10-26'), ahora: AHORA });

    const agenda = await agendaDeCobros(base.db, {
      hoy: dia('2026-10-26'),
      hasta: dia('2026-11-01'),
    });
    expect(formatear(agenda[0].monto)).toBe('Bs 600,00');
    expect(agenda[0].atrasado).toBe(true);
  });
});
