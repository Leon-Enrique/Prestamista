import { describe, expect, it } from 'vitest';

import {
  desdeTexto,
  desdeUnidades,
  dinero,
  formatear,
  porTasa,
  proporcion,
  repartir,
  restar,
  sumar,
  tasaDesdePorcentaje,
} from './dinero';
import { MonedaIncompatibleError, MontoInvalidoError } from './errores';

describe('construcción', () => {
  it('rechaza un monto con decimales', () => {
    expect(() => dinero(100.5, 'BOB')).toThrow(MontoInvalidoError);
  });

  it('convierte unidades a centavos', () => {
    expect(desdeUnidades(6000, 'BOB').centavos).toBe(600_000);
  });

  it('guarda la tasa en puntos básicos enteros', () => {
    expect(tasaDesdePorcentaje(10, 'mensual').puntosBasicos).toBe(1000);
    expect(tasaDesdePorcentaje(0.5, 'diario').puntosBasicos).toBe(50);
    expect(tasaDesdePorcentaje(12.25, 'mensual').puntosBasicos).toBe(1225);
  });
});

describe('desdeTexto', () => {
  it('lee un entero sin separadores', () => {
    expect(desdeTexto('6000', 'BOB').centavos).toBe(600_000);
  });

  it('trata el punto de miles como miles cuando lo siguen tres cifras', () => {
    expect(desdeTexto('6.000', 'BOB').centavos).toBe(600_000);
  });

  it('trata la coma como decimal cuando la siguen una o dos cifras', () => {
    expect(desdeTexto('6000,50', 'BOB').centavos).toBe(600_050);
    expect(desdeTexto('6000,5', 'BOB').centavos).toBe(600_050);
  });

  it('con los dos separadores, el último manda', () => {
    expect(desdeTexto('6.000,50', 'BOB').centavos).toBe(600_050);
    expect(desdeTexto('6,000.50', 'BOB').centavos).toBe(600_050);
  });

  it('acepta el símbolo de moneda adelante', () => {
    expect(desdeTexto('Bs 6.000', 'BOB').centavos).toBe(600_000);
  });

  it('rechaza más de dos decimales y texto que no es un número', () => {
    expect(() => desdeTexto('6000,555', 'BOB')).toThrow(MontoInvalidoError);
    expect(() => desdeTexto('como sea', 'BOB')).toThrow(MontoInvalidoError);
  });
});

describe('aritmética', () => {
  it('no deja sumar monedas distintas', () => {
    expect(() => sumar(desdeUnidades(100, 'BOB'), desdeUnidades(100, 'USD'))).toThrow(
      MonedaIncompatibleError,
    );
  });

  it('aplica una tasa: Bs 6.000 al 10% da Bs 600', () => {
    expect(porTasa(desdeUnidades(6000, 'BOB'), 1000).centavos).toBe(60_000);
  });

  it('prorratea por días: medio mes de interés es la mitad', () => {
    const interesDelMes = desdeUnidades(600, 'BOB');
    expect(proporcion(interesDelMes, 15, 30).centavos).toBe(30_000);
  });
});

describe('repartir', () => {
  it('cierra exacto y manda la diferencia a la última parte', () => {
    const partes = repartir(dinero(1000, 'BOB'), 3);
    expect(partes.map((p) => p.centavos)).toEqual([333, 333, 334]);
    expect(sumar(...partes).centavos).toBe(1000);
  });

  it('cierra exacto para cualquier cantidad de partes', () => {
    for (const cantidad of [1, 2, 4, 6, 7, 12, 24, 36]) {
      const monto = dinero(123_457, 'BOB');
      const partes = repartir(monto, cantidad);
      expect(partes).toHaveLength(cantidad);
      expect(sumar(...partes).centavos).toBe(monto.centavos);
    }
  });
});

describe('el problema que motiva todo esto', () => {
  it('sumar centavos enteros no acumula error de punto flotante', () => {
    // 0,1 + 0,2 en punto flotante no da 0,3. En centavos sí.
    const diez = dinero(10, 'BOB');
    const veinte = dinero(20, 'BOB');
    expect(sumar(diez, veinte).centavos).toBe(30);

    // Mil pagos de Bs 0,07 son exactamente Bs 70,00.
    let total = dinero(0, 'BOB');
    for (let i = 0; i < 1000; i += 1) {
      total = sumar(total, dinero(7, 'BOB'));
    }
    expect(total.centavos).toBe(7000);
    expect(formatear(total)).toBe('Bs 70,00');
  });
});

describe('formatear', () => {
  it('usa la convención boliviana: punto de miles y coma decimal', () => {
    expect(formatear(desdeUnidades(6000, 'BOB'))).toBe('Bs 6.000,00');
    expect(formatear(dinero(123_456_789, 'BOB'))).toBe('Bs 1.234.567,89');
    expect(formatear(desdeUnidades(1500, 'USD'))).toBe('$us 1.500,00');
  });

  it('muestra el signo de un monto negativo', () => {
    expect(formatear(restar(desdeUnidades(100, 'BOB'), desdeUnidades(150, 'BOB')))).toBe(
      '-Bs 50,00',
    );
  });
});
