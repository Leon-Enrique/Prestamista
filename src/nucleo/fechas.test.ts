import { describe, expect, it } from 'vitest';

import { DiaInvalidoError } from './errores';
import {
  dia,
  diasEntre,
  fechasPeriodicas,
  formatearDia,
  hoy,
  sumarDias,
  sumarMeses,
  vencimientoDePeriodo,
} from './fechas';

describe('validación', () => {
  it('acepta un día real', () => {
    expect(dia('2026-11-15')).toBe('2026-11-15');
  });

  it('rechaza una fecha que no existe', () => {
    expect(() => dia('2026-02-30')).toThrow(DiaInvalidoError);
    expect(() => dia('2026-13-01')).toThrow(DiaInvalidoError);
  });

  it('rechaza otro formato', () => {
    expect(() => dia('15/11/2026')).toThrow(DiaInvalidoError);
  });

  it('acepta el 29 de febrero de un año bisiesto y lo rechaza si no lo es', () => {
    expect(dia('2028-02-29')).toBe('2028-02-29');
    expect(() => dia('2027-02-29')).toThrow(DiaInvalidoError);
  });
});

describe('hoy()', () => {
  it('usa la fecha local, no la UTC', () => {
    const resultado = hoy();
    const ahora = new Date();
    const esperado = [
      ahora.getFullYear(),
      String(ahora.getMonth() + 1).padStart(2, '0'),
      String(ahora.getDate()).padStart(2, '0'),
    ].join('-');
    // A las 21:00 en Bolivia (UTC−4), toISOString() daría la fecha de mañana.
    expect(resultado).toBe(esperado);
  });
});

describe('sumarMeses', () => {
  it('recorta al último día del mes destino', () => {
    expect(sumarMeses(dia('2026-01-31'), 1)).toBe('2026-02-28');
    expect(sumarMeses(dia('2026-03-31'), 1)).toBe('2026-04-30');
  });

  it('respeta el año bisiesto al recortar', () => {
    expect(sumarMeses(dia('2028-01-31'), 1)).toBe('2028-02-29');
  });

  it('cruza el fin de año', () => {
    expect(sumarMeses(dia('2026-11-15'), 2)).toBe('2027-01-15');
  });

  it('resta meses', () => {
    expect(sumarMeses(dia('2026-01-15'), -2)).toBe('2025-11-15');
  });
});

describe('fechasPeriodicas', () => {
  it('mide siempre desde el origen, así una cuota recortada no arrastra a las siguientes', () => {
    // Encadenando mes a mes daría 28/02, 28/03, 28/04 y se perdería el ancla del 31.
    expect(fechasPeriodicas(dia('2026-01-31'), 'mensual', 3)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('arma un cronograma mensual normal', () => {
    expect(fechasPeriodicas(dia('2026-10-09'), 'mensual', 3)).toEqual([
      '2026-11-09',
      '2026-12-09',
      '2027-01-09',
    ]);
  });

  it('arma cronogramas semanales y quincenales', () => {
    expect(fechasPeriodicas(dia('2026-10-09'), 'semanal', 2)).toEqual([
      '2026-10-16',
      '2026-10-23',
    ]);
    expect(fechasPeriodicas(dia('2026-10-09'), 'quincenal', 2)).toEqual([
      '2026-10-24',
      '2026-11-08',
    ]);
  });

  it('el primer vencimiento diario es el día siguiente', () => {
    expect(vencimientoDePeriodo(dia('2026-10-09'), 'diaria', 1)).toBe('2026-10-10');
  });
});

describe('aritmética de días', () => {
  it('cuenta los días entre dos fechas', () => {
    expect(diasEntre(dia('2026-10-01'), dia('2026-10-11'))).toBe(10);
    expect(diasEntre(dia('2026-10-11'), dia('2026-10-01'))).toBe(-10);
    expect(diasEntre(dia('2026-10-01'), dia('2026-10-01'))).toBe(0);
  });

  it('cuenta bien cruzando un cambio de horario de verano', () => {
    // Si la aritmética usara horas locales, un mes con cambio de hora daría 29 o 31 días.
    expect(diasEntre(dia('2026-03-01'), dia('2026-04-01'))).toBe(31);
    expect(diasEntre(dia('2026-10-01'), dia('2026-11-01'))).toBe(31);
  });

  it('suma y resta días cruzando meses y años', () => {
    expect(sumarDias(dia('2026-12-31'), 1)).toBe('2027-01-01');
    expect(sumarDias(dia('2027-01-01'), -1)).toBe('2026-12-31');
  });
});

describe('presentación', () => {
  it('muestra la fecha como se escribe en Bolivia', () => {
    expect(formatearDia(dia('2026-11-05'))).toBe('05/11/2026');
  });
});
