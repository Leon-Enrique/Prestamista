import { describe, expect, it } from 'vitest';

import { desdeUnidades, formatear, type Moneda } from '../nucleo/dinero';
import { MonedaIncompatibleError, MontoInvalidoError } from '../nucleo/errores';
import { dia } from '../nucleo/fechas';
import { desgloseDeImputacion, imputarPago, totalParaSaldar } from './imputacion';
import { estadoSegunSaldo } from './obligaciones';
import type { Obligacion, TipoObligacion } from './tipos';

/** Arma una obligación para las pruebas. Los montos van en unidades, no en centavos. */
function ob(params: {
  id: number;
  tipo: TipoObligacion;
  vencimiento: string | null;
  numero?: number | null;
  moneda?: Moneda;
  capital?: number;
  interes?: number;
  mora?: number;
  pagadoCapital?: number;
  pagadoInteres?: number;
  pagadoMora?: number;
}): Obligacion {
  const moneda = params.moneda ?? 'BOB';
  const sinEstado = {
    id: params.id,
    prestamoId: 1,
    tipo: params.tipo,
    numero: params.numero ?? null,
    vencimiento: params.vencimiento === null ? null : dia(params.vencimiento),
    moneda,
    capital: desdeUnidades(params.capital ?? 0, moneda),
    interes: desdeUnidades(params.interes ?? 0, moneda),
    mora: desdeUnidades(params.mora ?? 0, moneda),
    pagadoCapital: desdeUnidades(params.pagadoCapital ?? 0, moneda),
    pagadoInteres: desdeUnidades(params.pagadoInteres ?? 0, moneda),
    pagadoMora: desdeUnidades(params.pagadoMora ?? 0, moneda),
    obligacionOrigenId: null,
    estado: 'pendiente' as const,
  };
  return { ...sinEstado, estado: estadoSegunSaldo(sinEstado) };
}

const HOY = dia('2026-10-11');

/**
 * El caso de Bs 6.000 al 10% mensual: venció el interés de Bs 600, se atrasó 10 días y
 * generó Bs 21 de mora, y el capital todavía no vence.
 */
function carteraDeJuan(): Obligacion[] {
  return [
    ob({ id: 1, tipo: 'interes', numero: 1, vencimiento: '2026-10-01', interes: 600 }),
    ob({ id: 2, tipo: 'mora', vencimiento: '2026-10-01', mora: 21 }),
    ob({ id: 3, tipo: 'capital', vencimiento: '2027-04-09', capital: 6000 }),
  ];
}

describe('el caso del pago parcial', () => {
  it('paga Bs 400: van Bs 21 a mora y Bs 379 a interés, el capital queda intacto', () => {
    const resultado = imputarPago({
      monto: desdeUnidades(400, 'BOB'),
      obligaciones: carteraDeJuan(),
      hasta: HOY,
    });

    const desglose = desgloseDeImputacion(resultado, 'BOB');
    expect(formatear(desglose.mora)).toBe('Bs 21,00');
    expect(formatear(desglose.interes)).toBe('Bs 379,00');
    expect(formatear(desglose.capital)).toBe('Bs 0,00');
    expect(formatear(resultado.aplicado)).toBe('Bs 400,00');
    expect(formatear(resultado.sobrante)).toBe('Bs 0,00');
  });

  it('el capital no baja con el pago del interés: sigue debiendo los Bs 6.000', () => {
    const resultado = imputarPago({
      monto: desdeUnidades(400, 'BOB'),
      obligaciones: carteraDeJuan(),
      hasta: HOY,
    });
    const alCapital = resultado.imputaciones.filter((i) => i.componente === 'capital');
    expect(alCapital).toHaveLength(0);
  });
});

describe('orden de imputación', () => {
  it('la mora se cobra primero, aunque su obligación tenga id más alto', () => {
    const resultado = imputarPago({
      monto: desdeUnidades(50, 'BOB'),
      obligaciones: carteraDeJuan(),
      hasta: HOY,
    });
    expect(resultado.imputaciones[0].componente).toBe('mora');
    expect(resultado.imputaciones[0].obligacionId).toBe(2);
  });

  it('el interés vencido va antes que el corriente', () => {
    const obligaciones = [
      ob({ id: 10, tipo: 'interes', numero: 2, vencimiento: '2026-11-01', interes: 600 }),
      ob({ id: 11, tipo: 'interes', numero: 1, vencimiento: '2026-10-01', interes: 600 }),
    ];

    const resultado = imputarPago({
      monto: desdeUnidades(600, 'BOB'),
      obligaciones,
      hasta: HOY,
    });

    expect(resultado.imputaciones).toHaveLength(1);
    expect(resultado.imputaciones[0].obligacionId).toBe(11);
  });

  it('nunca le imputa a una obligación más que su saldo', () => {
    const obligaciones = [
      ob({ id: 11, tipo: 'interes', numero: 1, vencimiento: '2026-10-01', interes: 600 }),
      ob({ id: 12, tipo: 'interes', numero: 2, vencimiento: '2026-11-01', interes: 600 }),
    ];

    // Bs 900: se agota el interés vencido (600) y el resto va al corriente (300).
    const resultado = imputarPago({
      monto: desdeUnidades(900, 'BOB'),
      obligaciones,
      hasta: HOY,
    });

    const porObligacion = new Map<number, number>();
    for (const i of resultado.imputaciones) {
      porObligacion.set(i.obligacionId, (porObligacion.get(i.obligacionId) ?? 0) + i.monto.centavos);
    }
    expect(porObligacion.get(11)).toBe(60_000);
    expect(porObligacion.get(12)).toBe(30_000);
    expect(resultado.aplicado.centavos).toBe(90_000);
  });

  it('lo más viejo primero entre obligaciones del mismo componente', () => {
    const obligaciones = [
      ob({ id: 20, tipo: 'cuota', numero: 2, vencimiento: '2026-09-01', interes: 100, capital: 400 }),
      ob({ id: 21, tipo: 'cuota', numero: 1, vencimiento: '2026-08-01', interes: 100, capital: 400 }),
    ];

    const resultado = imputarPago({
      monto: desdeUnidades(100, 'BOB'),
      obligaciones,
      hasta: HOY,
    });
    expect(resultado.imputaciones[0].obligacionId).toBe(21);
  });

  it('un capital sin vencimiento se cobra al final, después de todo lo que sí venció', () => {
    const obligaciones = [
      ob({ id: 30, tipo: 'capital', vencimiento: null, capital: 6000 }),
      ob({ id: 31, tipo: 'interes', numero: 1, vencimiento: '2026-10-01', interes: 600 }),
    ];

    const resultado = imputarPago({
      monto: desdeUnidades(6600, 'BOB'),
      obligaciones,
      hasta: HOY,
    });

    expect(resultado.imputaciones[0].obligacionId).toBe(31);
    expect(resultado.imputaciones[0].componente).toBe('interes');
    expect(resultado.imputaciones[1].obligacionId).toBe(30);
    expect(resultado.sobrante.centavos).toBe(0);
  });
});

describe('un pago que cubre varias cuotas', () => {
  it('liquida las primeras y deja la siguiente a medias', () => {
    const obligaciones = [1, 2, 3, 4].map((numero) =>
      ob({
        id: numero,
        tipo: 'cuota',
        numero,
        vencimiento: `2026-0${numero + 5}-01`,
        capital: 250,
        interes: 50,
      }),
    );

    // Bs 750 cubre dos cuotas y media de Bs 300.
    const resultado = imputarPago({
      monto: desdeUnidades(750, 'BOB'),
      obligaciones,
      hasta: dia('2026-10-11'),
    });

    const porObligacion = new Map<number, number>();
    for (const i of resultado.imputaciones) {
      porObligacion.set(i.obligacionId, (porObligacion.get(i.obligacionId) ?? 0) + i.monto.centavos);
    }

    expect(porObligacion.get(1)).toBe(30_000);
    expect(porObligacion.get(2)).toBe(30_000);
    expect(porObligacion.get(3)).toBe(15_000);
    expect(porObligacion.get(4)).toBeUndefined();
    expect(resultado.sobrante.centavos).toBe(0);
  });
});

describe('sobrante y saldado total', () => {
  it('lo que sobra queda a favor, no se reparte en deuda que no existe', () => {
    const resultado = imputarPago({
      monto: desdeUnidades(7000, 'BOB'),
      obligaciones: carteraDeJuan(),
      hasta: HOY,
    });

    expect(formatear(resultado.aplicado)).toBe('Bs 6.621,00');
    expect(formatear(resultado.sobrante)).toBe('Bs 379,00');
  });

  it('totalParaSaldar es exactamente lo que deja todo en cero', () => {
    const obligaciones = carteraDeJuan();
    const total = totalParaSaldar(obligaciones, 'BOB');
    expect(formatear(total)).toBe('Bs 6.621,00');

    const resultado = imputarPago({ monto: total, obligaciones, hasta: HOY });
    expect(resultado.sobrante.centavos).toBe(0);
    expect(resultado.aplicado.centavos).toBe(total.centavos);
  });

  it('no imputa nada si ya está todo pagado', () => {
    const obligaciones = [
      ob({ id: 40, tipo: 'interes', vencimiento: '2026-10-01', interes: 600, pagadoInteres: 600 }),
    ];
    const resultado = imputarPago({
      monto: desdeUnidades(100, 'BOB'),
      obligaciones,
      hasta: HOY,
    });
    expect(resultado.imputaciones).toHaveLength(0);
    expect(resultado.sobrante.centavos).toBe(10_000);
  });

  it('respeta lo ya cobrado de una obligación parcial', () => {
    const obligaciones = [
      ob({
        id: 50,
        tipo: 'interes',
        vencimiento: '2026-10-01',
        interes: 600,
        pagadoInteres: 379,
      }),
    ];
    const resultado = imputarPago({
      monto: desdeUnidades(500, 'BOB'),
      obligaciones,
      hasta: HOY,
    });
    expect(resultado.aplicado.centavos).toBe(22_100);
    expect(resultado.sobrante.centavos).toBe(27_900);
  });
});

describe('validaciones', () => {
  it('no acepta un pago de cero ni negativo: anular es un reverso, no un pago negativo', () => {
    expect(() =>
      imputarPago({ monto: desdeUnidades(0, 'BOB'), obligaciones: carteraDeJuan(), hasta: HOY }),
    ).toThrow(MontoInvalidoError);
  });

  it('no mezcla monedas', () => {
    expect(() =>
      imputarPago({
        monto: desdeUnidades(100, 'USD'),
        obligaciones: carteraDeJuan(),
        hasta: HOY,
      }),
    ).toThrow(MonedaIncompatibleError);
  });

  it('ignora las obligaciones condonadas y anuladas', () => {
    const obligaciones: Obligacion[] = [
      { ...ob({ id: 60, tipo: 'mora', vencimiento: '2026-10-01', mora: 21 }), estado: 'condonada' },
      ob({ id: 61, tipo: 'interes', vencimiento: '2026-10-01', interes: 600 }),
    ];

    const resultado = imputarPago({
      monto: desdeUnidades(100, 'BOB'),
      obligaciones,
      hasta: HOY,
    });

    expect(resultado.imputaciones).toHaveLength(1);
    expect(resultado.imputaciones[0].obligacionId).toBe(61);
    expect(resultado.imputaciones[0].componente).toBe('interes');
  });
});
