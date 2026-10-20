import { describe, expect, it } from 'vitest';

import { desdeUnidades, formatear } from '../nucleo/dinero';
import { dia } from '../nucleo/fechas';
import { calcularMora, moraPendienteDeDevengar } from './mora';
import { REGLAS_MORA_POR_DEFECTO, REGLAS_SIN_PENALIZACION, type ReglasMora } from './tipos';

const interesVencido = desdeUnidades(600, 'BOB');
const vencimiento = dia('2026-10-01');

describe('días de gracia', () => {
  it('no cobra mora dentro de los días de gracia', () => {
    for (const diasTarde of [0, 1, 2, 3]) {
      const calculo = calcularMora({
        montoVencido: interesVencido,
        vencimiento,
        hasta: dia(`2026-10-0${1 + diasTarde}`),
        reglas: REGLAS_MORA_POR_DEFECTO,
      });
      expect(calculo.monto.centavos).toBe(0);
    }
  });

  it('no cobra mora antes del vencimiento', () => {
    const calculo = calcularMora({
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2026-09-20'),
      reglas: REGLAS_MORA_POR_DEFECTO,
    });
    expect(calculo.diasDeAtraso).toBe(0);
    expect(calculo.monto.centavos).toBe(0);
  });
});

describe('porcentaje diario sobre el monto vencido', () => {
  it('Bs 600 vencidos pagados 10 días tarde: 7 días cobrables, Bs 21 de mora', () => {
    const calculo = calcularMora({
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2026-10-11'),
      reglas: REGLAS_MORA_POR_DEFECTO,
    });

    expect(calculo.diasDeAtraso).toBe(10);
    expect(calculo.diasCobrables).toBe(7);
    expect(formatear(calculo.monto)).toBe('Bs 21,00');
    expect(calculo.topeAlcanzado).toBe(false);
  });

  it('crece día a día mientras no toque el techo', () => {
    const alDia = (hasta: string) =>
      calcularMora({
        montoVencido: interesVencido,
        vencimiento,
        hasta: dia(hasta),
        reglas: REGLAS_MORA_POR_DEFECTO,
      }).monto.centavos;

    expect(alDia('2026-10-05')).toBe(300);
    expect(alDia('2026-10-06')).toBe(600);
    expect(alDia('2026-10-07')).toBe(900);
  });
});

describe('el techo', () => {
  it('la mora deja de crecer al 20% del monto vencido', () => {
    const calculo = calcularMora({
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2026-12-31'),
      reglas: REGLAS_MORA_POR_DEFECTO,
    });

    expect(calculo.diasDeAtraso).toBe(91);
    expect(formatear(calculo.monto)).toBe('Bs 120,00');
    expect(calculo.topeAlcanzado).toBe(true);
  });

  it('una deuda vieja no se multiplica sola: al año la mora sigue siendo el tope', () => {
    const calculo = calcularMora({
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2027-10-01'),
      reglas: REGLAS_MORA_POR_DEFECTO,
    });
    expect(formatear(calculo.monto)).toBe('Bs 120,00');
  });
});

describe('monto fijo por día', () => {
  const reglas: ReglasMora = {
    tipo: 'monto_fijo_diario',
    puntosBasicosDiarios: 0,
    centavosDiarios: 1000,
    diasDeGracia: 3,
    topePuntosBasicos: 2000,
  };

  it('cobra Bs 10 por cada día cobrable', () => {
    const calculo = calcularMora({
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2026-10-11'),
      reglas,
    });
    expect(calculo.diasCobrables).toBe(7);
    expect(formatear(calculo.monto)).toBe('Bs 70,00');
  });

  it('también respeta el techo', () => {
    const calculo = calcularMora({
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2026-12-31'),
      reglas,
    });
    expect(formatear(calculo.monto)).toBe('Bs 120,00');
  });
});

describe('devengo incremental e idempotente', () => {
  it('solo devenga la diferencia respecto a lo ya devengado', () => {
    const params = {
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2026-10-11'),
      reglas: REGLAS_MORA_POR_DEFECTO,
    };

    const primeraCorrida = moraPendienteDeDevengar({ ...params, yaDevengada: desdeUnidades(0, 'BOB') });
    expect(primeraCorrida.centavos).toBe(2100);

    // Correr de nuevo el mismo día no agrega nada: es lo que impide duplicar la deuda
    // de una persona real cuando la app se abre y se cierra varias veces.
    const segundaCorrida = moraPendienteDeDevengar({ ...params, yaDevengada: primeraCorrida });
    expect(segundaCorrida.centavos).toBe(0);
  });

  it('al día siguiente devenga solo el día nuevo', () => {
    const base = {
      montoVencido: interesVencido,
      vencimiento,
      reglas: REGLAS_MORA_POR_DEFECTO,
    };
    const hastaElOnce = moraPendienteDeDevengar({
      ...base,
      hasta: dia('2026-10-11'),
      yaDevengada: desdeUnidades(0, 'BOB'),
    });
    const elDoce = moraPendienteDeDevengar({
      ...base,
      hasta: dia('2026-10-12'),
      yaDevengada: hastaElOnce,
    });
    expect(elDoce.centavos).toBe(300);
  });

  it('nunca devuelve un monto negativo si ya se devengó de más', () => {
    const resultado = moraPendienteDeDevengar({
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2026-10-11'),
      reglas: REGLAS_MORA_POR_DEFECTO,
      yaDevengada: desdeUnidades(500, 'BOB'),
    });
    expect(resultado.centavos).toBe(0);
  });
});

describe('sin penalización', () => {
  it('no cobra nada por mucho que se atrase', () => {
    const calculo = calcularMora({
      montoVencido: interesVencido,
      vencimiento,
      hasta: dia('2027-10-01'),
      reglas: REGLAS_SIN_PENALIZACION,
    });
    expect(calculo.monto.centavos).toBe(0);
  });
});
