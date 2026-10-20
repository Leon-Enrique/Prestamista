import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import { cajaIniciada, saldoDeCaja } from '../datos/consultas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { crearCliente } from '../datos/repositorios/clientes';
import type { Condiciones } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { arquear, efectivoEsperado, MovimientoDeCajaInvalidoError, registrarManual } from './caja';
import { cobrar } from './cobrar';
import { desembolsar } from './desembolsar';
import { devengar } from './devengar';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;
const HOY = dia('2026-10-09');

let base: BaseDePrueba;
let db: EjecutorSQL;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  db = base.db;
});

const condiciones: Condiciones = {
  capital: desdeUnidades(6000, 'BOB'),
  tasa: tasaDesdePorcentaje(10, 'mensual'),
  modalidad: 'solo_interes',
  frecuencia: 'mensual',
  cantidadPeriodos: null,
  fechaDesembolso: HOY,
  vencimientoCapital: dia('2027-04-09'),
};

const saldoBs = async (): Promise<string> =>
  formatear(await efectivoEsperado(db, 'BOB'));

describe('movimientos a mano', () => {
  it('un aporte sube el efectivo', async () => {
    await registrarManual(db, {
      tipo: 'aporte',
      monto: desdeUnidades(10_000, 'BOB'),
      fecha: HOY,
      detalle: 'Capital inicial',
      ahora: AHORA,
    });
    expect(await saldoBs()).toBe('Bs 10.000,00');
  });

  it('un retiro y un gasto lo bajan', async () => {
    await registrarManual(db, {
      tipo: 'aporte',
      monto: desdeUnidades(10_000, 'BOB'),
      fecha: HOY,
      detalle: 'Capital inicial',
      ahora: AHORA,
    });
    await registrarManual(db, {
      tipo: 'retiro',
      monto: desdeUnidades(1500, 'BOB'),
      fecha: HOY,
      detalle: 'Para la casa',
      ahora: AHORA,
    });
    await registrarManual(db, {
      tipo: 'gasto',
      monto: desdeUnidades(50, 'BOB'),
      fecha: HOY,
      detalle: 'Pasajes',
      ahora: AHORA,
    });

    expect(await saldoBs()).toBe('Bs 8.450,00');
  });

  it('el signo lo decide el tipo: quien llama siempre pasa un monto positivo', async () => {
    await expect(
      registrarManual(db, {
        tipo: 'retiro',
        monto: desdeUnidades(-100, 'BOB'),
        fecha: HOY,
        detalle: 'mal',
        ahora: AHORA,
      }),
    ).rejects.toThrow(MovimientoDeCajaInvalidoError);
  });

  it('guarda el detalle, que es lo que explica el movimiento meses después', async () => {
    await registrarManual(db, {
      tipo: 'retiro',
      monto: desdeUnidades(500, 'BOB'),
      fecha: HOY,
      detalle: 'Para el colegio',
      ahora: AHORA,
    });

    const fila = base.sqlite
      .prepare("SELECT detalle FROM caja_movimientos WHERE tipo = 'retiro'")
      .get() as { detalle: string };
    expect(fila.detalle).toBe('Para el colegio');
  });
});

describe('la caja junto con los préstamos', () => {
  it('refleja el aporte, el desembolso y el cobro', async () => {
    await registrarManual(db, {
      tipo: 'aporte',
      monto: desdeUnidades(10_000, 'BOB'),
      fecha: HOY,
      detalle: 'Capital inicial',
      ahora: AHORA,
    });

    const clienteId = await crearCliente(db, { nombre: 'Juan Pérez' }, AHORA);
    const { prestamoId } = await desembolsar(db, { clienteId, condiciones, ahora: AHORA });
    // 10.000 − 6.000 prestados
    expect(await saldoBs()).toBe('Bs 4.000,00');

    await devengar(db, { hoy: dia('2026-11-09'), ahora: AHORA });
    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(600, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect(await saldoBs()).toBe('Bs 4.600,00');
  });

  it('separa las monedas: bolivianos y dólares nunca se suman', async () => {
    await registrarManual(db, {
      tipo: 'aporte',
      monto: desdeUnidades(10_000, 'BOB'),
      fecha: HOY,
      detalle: 'Bolivianos',
      ahora: AHORA,
    });
    await registrarManual(db, {
      tipo: 'aporte',
      monto: desdeUnidades(500, 'USD'),
      fecha: HOY,
      detalle: 'Dólares',
      ahora: AHORA,
    });

    const saldos = await saldoDeCaja(db);
    expect(saldos.map((s) => formatear(s))).toEqual(['Bs 10.000,00', '$us 500,00']);
  });
});

describe('arqueo', () => {
  beforeEach(async () => {
    await registrarManual(db, {
      tipo: 'aporte',
      monto: desdeUnidades(10_000, 'BOB'),
      fecha: HOY,
      detalle: 'Capital inicial',
      ahora: AHORA,
    });
  });

  it('cuando cuadra, lo deja registrado con monto cero', async () => {
    const resultado = await arquear(db, {
      moneda: 'BOB',
      contado: desdeUnidades(10_000, 'BOB'),
      fecha: HOY,
      ahora: AHORA,
    });

    expect(resultado.cuadro).toBe(true);
    expect(formatear(resultado.diferencia)).toBe('Bs 0,00');
    expect(await saldoBs()).toBe('Bs 10.000,00');

    const ajuste = base.sqlite
      .prepare("SELECT monto_centavos, detalle FROM caja_movimientos WHERE tipo = 'ajuste'")
      .get() as { monto_centavos: number; detalle: string };
    expect(ajuste.monto_centavos).toBe(0);
    expect(ajuste.detalle).toContain('cuadró');
  });

  it('cuando falta plata, el ajuste baja el saldo al contado', async () => {
    const resultado = await arquear(db, {
      moneda: 'BOB',
      contado: desdeUnidades(9950, 'BOB'),
      fecha: HOY,
      detalle: 'No sé qué pasó',
      ahora: AHORA,
    });

    expect(resultado.cuadro).toBe(false);
    expect(formatear(resultado.esperado)).toBe('Bs 10.000,00');
    expect(formatear(resultado.diferencia)).toBe('-Bs 50,00');

    // Después del arqueo, el sistema dice lo que de verdad hay en la mano.
    expect(await saldoBs()).toBe('Bs 9.950,00');
  });

  it('cuando sobra plata, el ajuste sube el saldo al contado', async () => {
    const resultado = await arquear(db, {
      moneda: 'BOB',
      contado: desdeUnidades(10_030, 'BOB'),
      fecha: HOY,
      ahora: AHORA,
    });

    expect(formatear(resultado.diferencia)).toBe('Bs 30,00');
    expect(await saldoBs()).toBe('Bs 10.030,00');
  });

  it('no corrige el pasado: la diferencia queda como un asiento con su motivo', async () => {
    await arquear(db, {
      moneda: 'BOB',
      contado: desdeUnidades(9950, 'BOB'),
      fecha: HOY,
      detalle: 'Capaz di cambio mal',
      ahora: AHORA,
    });

    // El aporte original sigue intacto: nada se editó para que cuadre.
    const aporte = base.sqlite
      .prepare("SELECT monto_centavos FROM caja_movimientos WHERE tipo = 'aporte'")
      .get() as { monto_centavos: number };
    expect(aporte.monto_centavos).toBe(1_000_000);

    const ajuste = base.sqlite
      .prepare("SELECT monto_centavos, detalle FROM caja_movimientos WHERE tipo = 'ajuste'")
      .get() as { monto_centavos: number; detalle: string };
    expect(ajuste.monto_centavos).toBe(-5000);
    expect(ajuste.detalle).toContain('faltaban Bs 50,00');
    expect(ajuste.detalle).toContain('Capaz di cambio mal');
  });

  it('un segundo arqueo seguido cuadra, porque el primero ya ajustó', async () => {
    await arquear(db, {
      moneda: 'BOB',
      contado: desdeUnidades(9950, 'BOB'),
      fecha: HOY,
      ahora: AHORA,
    });
    const segundo = await arquear(db, {
      moneda: 'BOB',
      contado: desdeUnidades(9950, 'BOB'),
      fecha: HOY,
      ahora: AHORA,
    });
    expect(segundo.cuadro).toBe(true);
  });

  it('arquea cada moneda por su cuenta', async () => {
    await registrarManual(db, {
      tipo: 'aporte',
      monto: desdeUnidades(500, 'USD'),
      fecha: HOY,
      detalle: 'Dólares',
      ahora: AHORA,
    });

    const resultado = await arquear(db, {
      moneda: 'USD',
      contado: desdeUnidades(480, 'USD'),
      fecha: HOY,
      ahora: AHORA,
    });

    expect(formatear(resultado.diferencia)).toBe('-$us 20,00');
    // Los bolivianos no se tocaron.
    expect(await saldoBs()).toBe('Bs 10.000,00');
  });

  it('rechaza contar efectivo negativo', async () => {
    await expect(
      arquear(db, {
        moneda: 'BOB',
        contado: desdeUnidades(-10, 'BOB'),
        fecha: HOY,
        ahora: AHORA,
      }),
    ).rejects.toThrow(MovimientoDeCajaInvalidoError);
  });
});

describe('caja inicial', () => {
  it('no está iniciada hasta que se anota con cuánto se empieza', async () => {
    expect(await cajaIniciada(db)).toBe(false);

    // Un préstamo solo no la inicia: la deja en negativo.
    const clienteId = await crearCliente(db, { nombre: 'Ana', ci: '1', telefono: '7' }, AHORA);
    await desembolsar(db, { clienteId, condiciones, ahora: AHORA });
    expect(await cajaIniciada(db)).toBe(false);

    await registrarManual(db, {
      tipo: 'aporte',
      monto: desdeUnidades(10000, 'BOB'),
      fecha: HOY,
      detalle: 'Capital inicial',
      ahora: AHORA,
    });
    expect(await cajaIniciada(db)).toBe(true);
    expect(await saldoBs()).toBe('Bs 4.000,00');
  });
});
