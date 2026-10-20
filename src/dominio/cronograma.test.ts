import { describe, expect, it } from 'vitest';

import { desdeUnidades, formatear, sumar, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia } from '../nucleo/fechas';
import {
  CronogramaInvalidoError,
  generarCronograma,
  proyectarSoloInteres,
  resumenCronograma,
} from './cronograma';
import type { Condiciones, Modalidad } from './tipos';

function condiciones(modalidad: Modalidad, overrides: Partial<Condiciones> = {}): Condiciones {
  return {
    capital: desdeUnidades(1000, 'BOB'),
    tasa: tasaDesdePorcentaje(5, 'mensual'),
    modalidad,
    frecuencia: 'mensual',
    cantidadPeriodos: 4,
    fechaDesembolso: dia('2026-10-09'),
    vencimientoCapital: dia('2027-02-09'),
    ...overrides,
  };
}

describe('la regla que todo cronograma debe cumplir', () => {
  const modalidades: Modalidad[] = ['cuota_fija', 'capital_fijo', 'interes_flat', 'pago_unico'];

  it.each(modalidades)('en %s, el capital de las cuotas suma exactamente el prestado', (m) => {
    const lineas = generarCronograma(condiciones(m));
    expect(sumar(...lineas.map((l) => l.capital)).centavos).toBe(100_000);
  });

  it.each(modalidades)('en %s, el total a pagar cierra sin centavos colgados', (m) => {
    const lineas = generarCronograma(condiciones(m));
    const resumen = resumenCronograma(lineas);
    expect(sumar(resumen.totalCapital, resumen.totalInteres).centavos).toBe(
      resumen.totalAPagar.centavos,
    );
  });

  it.each(modalidades)('en %s, la última línea deja el saldo de capital en cero', (m) => {
    const lineas = generarCronograma(condiciones(m));
    expect(lineas[lineas.length - 1].saldoCapital.centavos).toBe(0);
  });

  it('cierra exacto también con capitales que no se dividen bien', () => {
    for (const unidades of [1000, 1001, 3333, 6007, 12_345]) {
      for (const periodos of [3, 6, 7, 12]) {
        const lineas = generarCronograma(
          condiciones('cuota_fija', {
            capital: desdeUnidades(unidades, 'BOB'),
            cantidadPeriodos: periodos,
          }),
        );
        expect(sumar(...lineas.map((l) => l.capital)).centavos).toBe(unidades * 100);
      }
    }
  });
});

describe('interés sobre capital original (flat)', () => {
  it('Bs 1.000 al 5% mensual en 4 cuotas: Bs 200 de interés, cuota de Bs 300', () => {
    const lineas = generarCronograma(condiciones('interes_flat'));
    const resumen = resumenCronograma(lineas);

    expect(formatear(resumen.totalInteres)).toBe('Bs 200,00');
    expect(formatear(resumen.totalAPagar)).toBe('Bs 1.200,00');
    expect(formatear(resumen.cuotaMinima)).toBe('Bs 300,00');
    expect(formatear(resumen.cuotaMaxima)).toBe('Bs 300,00');
  });

  it('el interés no baja aunque el saldo baje', () => {
    const lineas = generarCronograma(condiciones('interes_flat'));
    expect(lineas.map((l) => l.interes.centavos)).toEqual([5000, 5000, 5000, 5000]);
  });
});

describe('cuota fija (sistema francés)', () => {
  it('Bs 1.000 al 5% mensual en 4 cuotas: Bs 128,05 de interés', () => {
    const lineas = generarCronograma(condiciones('cuota_fija'));
    const resumen = resumenCronograma(lineas);

    expect(formatear(resumen.totalInteres)).toBe('Bs 128,05');
    expect(formatear(resumen.totalAPagar)).toBe('Bs 1.128,05');
  });

  it('el interés baja y el capital sube', () => {
    const lineas = generarCronograma(condiciones('cuota_fija'));
    expect(lineas.map((l) => l.interes.centavos)).toEqual([5000, 3840, 2622, 1343]);
    expect(lineas.map((l) => l.capital.centavos)).toEqual([23_201, 24_361, 25_579, 26_859]);
  });

  it('rinde bastante menos que el flat a la misma tasa: no son lo mismo', () => {
    const flat = resumenCronograma(generarCronograma(condiciones('interes_flat')));
    const frances = resumenCronograma(generarCronograma(condiciones('cuota_fija')));
    expect(flat.totalInteres.centavos).toBeGreaterThan(frances.totalInteres.centavos);
    expect(flat.totalInteres.centavos).toBe(20_000);
    expect(frances.totalInteres.centavos).toBe(12_805);
  });

  it('con tasa cero reparte solo el capital', () => {
    const lineas = generarCronograma(
      condiciones('cuota_fija', { tasa: tasaDesdePorcentaje(0, 'mensual') }),
    );
    expect(resumenCronograma(lineas).totalInteres.centavos).toBe(0);
    expect(sumar(...lineas.map((l) => l.capital)).centavos).toBe(100_000);
  });
});

describe('capital fijo (sistema alemán)', () => {
  it('amortiza el capital en partes iguales y la cuota va bajando', () => {
    const lineas = generarCronograma(condiciones('capital_fijo'));
    expect(lineas.map((l) => l.capital.centavos)).toEqual([25_000, 25_000, 25_000, 25_000]);
    expect(lineas.map((l) => l.interes.centavos)).toEqual([5000, 3750, 2500, 1250]);
  });
});

describe('pago único', () => {
  it('una sola línea con el interés simple de todos los períodos', () => {
    const lineas = generarCronograma(condiciones('pago_unico'));
    expect(lineas).toHaveLength(1);
    expect(lineas[0].vencimiento).toBe('2027-02-09');
    expect(lineas[0].capital.centavos).toBe(100_000);
    expect(lineas[0].interes.centavos).toBe(20_000);
  });
});

describe('solo interés: no tiene cronograma', () => {
  it('generarCronograma lo rechaza y explica por qué', () => {
    expect(() => generarCronograma(condiciones('solo_interes'))).toThrow(
      CronogramaInvalidoError,
    );
  });

  it('la proyección repite el mismo interés cada período, sobre el capital colocado', () => {
    const lineas = proyectarSoloInteres(
      condiciones('solo_interes', {
        capital: desdeUnidades(6000, 'BOB'),
        tasa: tasaDesdePorcentaje(10, 'mensual'),
      }),
      6,
    );

    expect(lineas).toHaveLength(6);
    expect(lineas.map((l) => l.interes.centavos)).toEqual([
      60_000, 60_000, 60_000, 60_000, 60_000, 60_000,
    ]);
  });

  it('el capital recién aparece en el último período, y antes el saldo no baja', () => {
    const lineas = proyectarSoloInteres(
      condiciones('solo_interes', { capital: desdeUnidades(6000, 'BOB') }),
      6,
    );
    expect(lineas.slice(0, 5).map((l) => l.capital.centavos)).toEqual([0, 0, 0, 0, 0]);
    expect(lineas[5].capital.centavos).toBe(600_000);
    expect(lineas[0].saldoCapital.centavos).toBe(600_000);
  });

  it('sin vencimiento de capital, el capital nunca entra en la proyección', () => {
    const lineas = proyectarSoloInteres(
      condiciones('solo_interes', {
        capital: desdeUnidades(6000, 'BOB'),
        vencimientoCapital: null,
      }),
      3,
    );
    expect(lineas.every((l) => l.capital.centavos === 0)).toBe(true);
  });
});

describe('validaciones', () => {
  it('rechaza un cronograma sin períodos', () => {
    expect(() => generarCronograma(condiciones('cuota_fija', { cantidadPeriodos: 0 }))).toThrow(
      CronogramaInvalidoError,
    );
    expect(() =>
      generarCronograma(condiciones('cuota_fija', { cantidadPeriodos: null })),
    ).toThrow(CronogramaInvalidoError);
  });

  it('rechaza capital en cero', () => {
    expect(() =>
      generarCronograma(condiciones('cuota_fija', { capital: desdeUnidades(0, 'BOB') })),
    ).toThrow(CronogramaInvalidoError);
  });
});
