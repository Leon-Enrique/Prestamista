import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import type { EjecutorSQL } from '../datos/ejecutor';
import { crearCliente } from '../datos/repositorios/clientes';
import { obligacionesDePrestamo } from '../datos/repositorios/obligaciones';
import { verificar } from '../datos/verificacion';
import { resumenDeuda } from '../dominio/obligaciones';
import type { Condiciones, Obligacion } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { ajustar, AjusteInvalidoError } from './ajustar';
import { cobrar } from './cobrar';
import { condonar } from './condonar';
import { desembolsar } from './desembolsar';
import { devengar } from './devengar';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;
const DESEMBOLSO = dia('2026-10-09');

let base: BaseDePrueba;
let db: EjecutorSQL;
let prestamoId: number;

/** Bs 1.000 al 5% en 4 cuotas de Bs 300 (interés sobre el monto prestado). */
const condiciones: Condiciones = {
  capital: desdeUnidades(1000, 'BOB'),
  tasa: tasaDesdePorcentaje(5, 'mensual'),
  modalidad: 'interes_flat',
  frecuencia: 'mensual',
  cantidadPeriodos: 4,
  fechaDesembolso: DESEMBOLSO,
  vencimientoCapital: dia('2027-02-09'),
};

beforeEach(async () => {
  base = await crearBaseDePrueba();
  db = base.db;
  const clienteId = await crearCliente(db, { nombre: 'Juan Pérez' }, AHORA);
  prestamoId = (await desembolsar(db, { clienteId, condiciones, ahora: AHORA })).prestamoId;
});

const cuotas = async (): Promise<Obligacion[]> => obligacionesDePrestamo(db, prestamoId);

describe('bajarle el monto a una cuota', () => {
  it('"este mes pagame 200 menos": baja el capital y deja el rastro', async () => {
    const primera = (await cuotas())[0];
    expect(formatear(primera.capital)).toBe('Bs 250,00');

    const resultado = await ajustar(db, {
      obligacionId: primera.id,
      nuevoCapital: desdeUnidades(50, 'BOB'),
      motivo: 'Este mes no le alcanzaba, lo acomodamos',
      fecha: DESEMBOLSO,
      ahora: AHORA,
    });

    expect(formatear(resultado.diferencia)).toBe('-Bs 200,00');

    const despues = (await cuotas())[0];
    expect(formatear(despues.capital)).toBe('Bs 50,00');
    // El interés de la cuota no se tocó.
    expect(formatear(despues.interes)).toBe('Bs 50,00');
  });

  it('baja la deuda total del préstamo', async () => {
    const antes = resumenDeuda(await cuotas(), 'BOB', DESEMBOLSO);
    expect(formatear(antes.total)).toBe('Bs 1.200,00');

    const primera = (await cuotas())[0];
    await ajustar(db, {
      obligacionId: primera.id,
      nuevoCapital: desdeUnidades(50, 'BOB'),
      motivo: 'acomodado',
      fecha: DESEMBOLSO,
      ahora: AHORA,
    });

    const despues = resumenDeuda(await cuotas(), 'BOB', DESEMBOLSO);
    expect(formatear(despues.total)).toBe('Bs 1.000,00');
  });

  it('deja su asiento con el motivo y la diferencia', async () => {
    const primera = (await cuotas())[0];
    await ajustar(db, {
      obligacionId: primera.id,
      nuevoCapital: desdeUnidades(50, 'BOB'),
      motivo: 'Se le enfermó el hijo',
      fecha: DESEMBOLSO,
      ahora: AHORA,
    });

    const asiento = base.sqlite
      .prepare("SELECT capital_centavos, detalle FROM movimientos WHERE tipo = 'ajuste'")
      .get() as { capital_centavos: number; detalle: string };

    expect(asiento.capital_centavos).toBe(-20_000);
    expect(asiento.detalle).toContain('Se le enfermó el hijo');
  });
});

describe('subirle el monto', () => {
  it('se puede sumar lo que se descontó antes', async () => {
    const todas = await cuotas();
    await ajustar(db, {
      obligacionId: todas[0].id,
      nuevoCapital: desdeUnidades(50, 'BOB'),
      motivo: 'este mes menos',
      fecha: DESEMBOLSO,
      ahora: AHORA,
    });
    const resultado = await ajustar(db, {
      obligacionId: todas[1].id,
      nuevoCapital: desdeUnidades(450, 'BOB'),
      motivo: 'el mes que viene lo pone',
      fecha: DESEMBOLSO,
      ahora: AHORA,
    });

    expect(formatear(resultado.diferencia)).toBe('Bs 200,00');
    // El total vuelve a ser el de siempre: se corrió plata de un mes al otro.
    const deuda = resumenDeuda(await cuotas(), 'BOB', DESEMBOLSO);
    expect(formatear(deuda.total)).toBe('Bs 1.200,00');
  });
});

describe('mover el vencimiento', () => {
  it('"te doy una semana más"', async () => {
    const primera = (await cuotas())[0];
    expect(primera.vencimiento).toBe('2026-11-09');

    await ajustar(db, {
      obligacionId: primera.id,
      nuevoVencimiento: dia('2026-11-16'),
      motivo: 'Le cae el sueldo el 15',
      fecha: DESEMBOLSO,
      ahora: AHORA,
    });

    expect((await cuotas())[0].vencimiento).toBe('2026-11-16');
  });

  it('no borra la mora ya devengada: eso es condonar', async () => {
    await devengar(db, { hoy: dia('2026-11-20'), ahora: AHORA });
    const conMora = await cuotas();
    const mora = conMora.find((o) => o.tipo === 'mora')!;
    expect(formatear(mora.mora)).toBe('Bs 12,00');

    const primera = conMora.find((o) => o.tipo === 'cuota')!;
    await ajustar(db, {
      obligacionId: primera.id,
      nuevoVencimiento: dia('2026-12-09'),
      motivo: 'Se lo corremos un mes',
      fecha: dia('2026-11-20'),
      ahora: AHORA,
    });

    // La mora de un atraso que ocurrió, ocurrió.
    const despues = await cuotas();
    expect(formatear(despues.find((o) => o.tipo === 'mora')!.mora)).toBe('Bs 12,00');

    // Para que desaparezca hay que condonarla, que es una decisión explícita.
    await condonar(db, {
      obligacionId: mora.id,
      motivo: 'Se la perdono junto con el plazo',
      fecha: dia('2026-11-20'),
      ahora: AHORA,
    });
    const deuda = resumenDeuda(await cuotas(), 'BOB', dia('2026-11-20'));
    expect(formatear(deuda.mora)).toBe('Bs 0,00');
  });

  it('el devengo no vuelve a cobrar mora del período corrido', async () => {
    await devengar(db, { hoy: dia('2026-11-20'), ahora: AHORA });
    const primera = (await cuotas()).find((o) => o.tipo === 'cuota')!;

    await ajustar(db, {
      obligacionId: primera.id,
      nuevoVencimiento: dia('2026-12-09'),
      motivo: 'un mes más',
      fecha: dia('2026-11-20'),
      ahora: AHORA,
    });

    const devengo = await devengar(db, { hoy: dia('2026-11-25'), ahora: AHORA });
    expect(devengo.morasCreadas).toBe(0);
    expect(devengo.morasAumentadas).toBe(0);
  });
});

describe('lo que no deja hacer', () => {
  it('no deja dejar un monto por debajo de lo ya cobrado', async () => {
    const primera = (await cuotas())[0];
    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(300, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });

    await expect(
      ajustar(db, {
        obligacionId: primera.id,
        nuevoCapital: desdeUnidades(10, 'BOB'),
        motivo: 'quiero bajarla',
        fecha: dia('2026-11-09'),
        ahora: AHORA,
      }),
    ).rejects.toThrow(AjusteInvalidoError);
  });

  it('no deja ajustar una cuota ya pagada', async () => {
    const primera = (await cuotas())[0];
    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(300, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });

    await expect(
      ajustar(db, {
        obligacionId: primera.id,
        nuevoCapital: desdeUnidades(400, 'BOB'),
        motivo: 'subirla',
        fecha: dia('2026-11-09'),
        ahora: AHORA,
      }),
    ).rejects.toThrow(AjusteInvalidoError);
  });

  it('no deja ajustar sin motivo', async () => {
    const primera = (await cuotas())[0];
    await expect(
      ajustar(db, {
        obligacionId: primera.id,
        nuevoCapital: desdeUnidades(50, 'BOB'),
        motivo: '   ',
        fecha: DESEMBOLSO,
        ahora: AHORA,
      }),
    ).rejects.toThrow(AjusteInvalidoError);
  });
});

describe('el libro sigue cuadrando', () => {
  it('después de ajustar, cobrar y volver a ajustar', async () => {
    const todas = await cuotas();

    await ajustar(db, {
      obligacionId: todas[0].id,
      nuevoCapital: desdeUnidades(50, 'BOB'),
      motivo: 'menos este mes',
      fecha: DESEMBOLSO,
      ahora: AHORA,
    });
    expect((await verificar(db)).cuadra).toBe(true);

    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(100, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect((await verificar(db)).cuadra).toBe(true);

    await ajustar(db, {
      obligacionId: todas[1].id,
      nuevoCapital: desdeUnidades(450, 'BOB'),
      motivo: 'lo pone el mes que viene',
      fecha: dia('2026-11-09'),
      ahora: AHORA,
    });
    expect((await verificar(db)).cuadra).toBe(true);
  });

  it('una cuota ajustada a lo que ya se cobró queda pagada', async () => {
    const primera = (await cuotas())[0];
    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(100, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });

    // Cobró 100: 50 de interés y 50 de capital. Se le deja la cuota en eso.
    await ajustar(db, {
      obligacionId: primera.id,
      nuevoCapital: desdeUnidades(50, 'BOB'),
      motivo: 'Con eso queda al día',
      fecha: dia('2026-11-09'),
      ahora: AHORA,
    });

    expect((await cuotas())[0].estado).toBe('pagada');
  });
});
