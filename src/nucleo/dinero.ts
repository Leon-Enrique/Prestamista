/**
 * Dinero en centavos enteros, con su moneda adentro.
 *
 * Regla del proyecto, sin excepciones: **todo monto es un entero de centavos**. Nunca un
 * decimal. En punto flotante `0.1 + 0.2` no da `0.3`, y un sistema que suma miles de pagos
 * y hace arqueos contra efectivo contado acumula ese error hasta que la caja no cuadra.
 *
 * Los enteros de JavaScript son exactos hasta 2^53, que en centavos son más de noventa
 * billones: de sobra para cualquier cartera.
 *
 * Sumar dos montos de monedas distintas lanza `MonedaIncompatibleError`. No es una
 * precaución: bolivianos y dólares conviven en la misma cartera y sumarlos en silencio
 * daría un número que parece correcto y no significa nada.
 */

import { MonedaIncompatibleError, MontoInvalidoError, TasaInvalidaError } from './errores';

export type Moneda = 'BOB' | 'USD';

export const MONEDAS: readonly Moneda[] = ['BOB', 'USD'];

export type Dinero = {
  readonly centavos: number;
  readonly moneda: Moneda;
};

/**
 * Una tasa nunca viaja sola: siempre con su período.
 *
 * Se guarda en **puntos básicos enteros** (1 pb = 0,01%) para no arrastrar decimales:
 * 10% = 1000 pb, 0,5% = 50 pb, 12,25% = 1225 pb. Dos decimales de porcentaje, que es más
 * de lo que el rubro usa.
 */
export type PeriodoTasa = 'diario' | 'semanal' | 'quincenal' | 'mensual' | 'anual';

export type Tasa = {
  readonly puntosBasicos: number;
  readonly periodo: PeriodoTasa;
};

// --- Construcción ---------------------------------------------------------------------

export function dinero(centavos: number, moneda: Moneda): Dinero {
  if (!Number.isSafeInteger(centavos)) {
    throw new MontoInvalidoError(
      `Un monto debe ser un entero de centavos, llegó ${centavos}. ` +
        'Si viene de una división o de una tasa, redondealo con las funciones de este módulo.',
    );
  }
  return { centavos, moneda };
}

export function cero(moneda: Moneda): Dinero {
  return { centavos: 0, moneda };
}

/** `desdeUnidades(6000, 'BOB')` → Bs 6.000,00 */
export function desdeUnidades(unidades: number, moneda: Moneda): Dinero {
  return dinero(Math.round(unidades * 100), moneda);
}

export function tasa(puntosBasicos: number, periodo: PeriodoTasa): Tasa {
  if (!Number.isSafeInteger(puntosBasicos) || puntosBasicos < 0) {
    throw new TasaInvalidaError(
      `La tasa debe ser un entero de puntos básicos no negativo, llegó ${puntosBasicos}.`,
    );
  }
  return { puntosBasicos, periodo };
}

/** `tasaDesdePorcentaje(10, 'mensual')` → 10% mensual. Acepta hasta dos decimales. */
export function tasaDesdePorcentaje(porcentaje: number, periodo: PeriodoTasa): Tasa {
  return tasa(Math.round(porcentaje * 100), periodo);
}

export function porcentajeDeTasa(t: Tasa): number {
  return t.puntosBasicos / 100;
}

// --- Entrada de texto -----------------------------------------------------------------

/**
 * Convierte lo que el usuario escribe en un monto.
 *
 * Acepta `6000`, `6.000`, `6000,50`, `6.000,50` y `6,000.50`. La regla, cuando aparecen
 * los dos separadores, es que **el último manda** como decimal; cuando aparece uno solo,
 * es decimal si lo siguen una o dos cifras, y separador de miles si lo siguen tres.
 *
 * La pantalla debería usar teclado numérico y guardar centavos directo; esto está para el
 * texto pegado y para la importación.
 */
export function desdeTexto(texto: string, moneda: Moneda): Dinero {
  const limpio = texto.replace(/[\s ]/g, '').replace(/^(Bs|\$us|\$|USD|BOB)/i, '');
  if (limpio === '' || !/^-?[\d.,]+$/.test(limpio)) {
    throw new MontoInvalidoError(`No se entiende el monto "${texto}".`);
  }

  const negativo = limpio.startsWith('-');
  const cuerpo = negativo ? limpio.slice(1) : limpio;

  const ultimaComa = cuerpo.lastIndexOf(',');
  const ultimoPunto = cuerpo.lastIndexOf('.');
  const posicionDecimal = Math.max(ultimaComa, ultimoPunto);

  let entera: string;
  let decimal: string;

  if (posicionDecimal === -1) {
    entera = cuerpo;
    decimal = '';
  } else {
    const cifrasDespues = cuerpo.length - posicionDecimal - 1;
    const hayAmbos = ultimaComa !== -1 && ultimoPunto !== -1;
    const esDecimal = hayAmbos || (cifrasDespues >= 1 && cifrasDespues <= 2);
    if (esDecimal) {
      entera = cuerpo.slice(0, posicionDecimal);
      decimal = cuerpo.slice(posicionDecimal + 1);
    } else {
      entera = cuerpo;
      decimal = '';
    }
  }

  // Si los separadores que quedaron en la parte entera son de miles, la agrupación tiene que
  // ser válida: grupos de tres. Sin esta validación `6000,555` se leería como seis millones
  // en vez de rechazarse, y un monto mal leído por mil es el error que no puede pasar.
  const agrupacionValida = /^\d+$/.test(entera) || /^\d{1,3}([.,]\d{3})+$/.test(entera);
  if (!agrupacionValida) {
    throw new MontoInvalidoError(
      `No se entiende el monto "${texto}": revisá los separadores de miles y decimales.`,
    );
  }

  const digitosEnteros = entera.replace(/[.,]/g, '');
  const digitosDecimales = decimal.replace(/[.,]/g, '');
  if (digitosDecimales.length > 2) {
    throw new MontoInvalidoError(`El monto "${texto}" tiene más de dos decimales.`);
  }

  const unidades = digitosEnteros === '' ? 0 : Number(digitosEnteros);
  const centesimos = Number((digitosDecimales + '00').slice(0, 2));
  if (!Number.isSafeInteger(unidades)) {
    throw new MontoInvalidoError(`El monto "${texto}" es demasiado grande.`);
  }

  const total = unidades * 100 + centesimos;
  return dinero(negativo ? -total : total, moneda);
}

// --- Aritmética -----------------------------------------------------------------------

function exigirMismaMoneda(a: Dinero, b: Dinero): void {
  if (a.moneda !== b.moneda) {
    throw new MonedaIncompatibleError(
      `No se pueden operar ${a.moneda} y ${b.moneda} en la misma cuenta. ` +
        'Los totales se muestran separados por moneda, o se convierten con un tipo de cambio guardado.',
    );
  }
}

export function sumar(...montos: Dinero[]): Dinero {
  if (montos.length === 0) {
    throw new MontoInvalidoError('sumar() necesita al menos un monto para saber la moneda.');
  }
  return montos.reduce((acumulado, actual) => {
    exigirMismaMoneda(acumulado, actual);
    return dinero(acumulado.centavos + actual.centavos, acumulado.moneda);
  });
}

export function restar(a: Dinero, b: Dinero): Dinero {
  exigirMismaMoneda(a, b);
  return dinero(a.centavos - b.centavos, a.moneda);
}

export function negar(d: Dinero): Dinero {
  return dinero(-d.centavos, d.moneda);
}

export function porEntero(d: Dinero, factor: number): Dinero {
  if (!Number.isSafeInteger(factor)) {
    throw new MontoInvalidoError(`El factor debe ser entero, llegó ${factor}.`);
  }
  return dinero(d.centavos * factor, d.moneda);
}

/**
 * Aplica una tasa a un monto. `porTasa(Bs 6.000, 1000 pb)` → Bs 600.
 *
 * El redondeo se hace una sola vez, al final, y es medio arriba. Está acá y en ningún otro
 * lugar: una segunda regla de redondeo en otro módulo es cómo aparecen diferencias de
 * centavos que nadie puede explicar.
 */
export function porTasa(d: Dinero, puntosBasicos: number): Dinero {
  return dinero(Math.round((d.centavos * puntosBasicos) / 10_000), d.moneda);
}

/**
 * Parte proporcional de un monto: `proporcion(interesDelMes, 15, 30)` es el interés de 15
 * días de un mes de 30. Multiplica primero y divide una sola vez, para no perder precisión.
 */
export function proporcion(d: Dinero, numerador: number, denominador: number): Dinero {
  if (denominador === 0) {
    throw new MontoInvalidoError('El denominador de una proporción no puede ser cero.');
  }
  return dinero(Math.round((d.centavos * numerador) / denominador), d.moneda);
}

/**
 * Reparte un monto en partes iguales y **manda la diferencia a la última**.
 *
 * Es la regla de redondeo de los cronogramas: si cada cuota se redondea por su cuenta, la
 * suma no cierra y al cliente le queda una deuda de tres centavos para siempre, que después
 * ensucia la mora y los reportes. Así, `sumar(...repartir(d, n))` es exactamente `d`.
 */
export function repartir(d: Dinero, partes: number): Dinero[] {
  if (!Number.isSafeInteger(partes) || partes <= 0) {
    throw new MontoInvalidoError(`No se puede repartir en ${partes} partes.`);
  }
  const base = Math.trunc(d.centavos / partes);
  const resultado: Dinero[] = [];
  for (let i = 0; i < partes - 1; i += 1) {
    resultado.push(dinero(base, d.moneda));
  }
  resultado.push(dinero(d.centavos - base * (partes - 1), d.moneda));
  return resultado;
}

// --- Comparación ----------------------------------------------------------------------

export function comparar(a: Dinero, b: Dinero): number {
  exigirMismaMoneda(a, b);
  return a.centavos - b.centavos;
}

export const esCero = (d: Dinero): boolean => d.centavos === 0;
export const esPositivo = (d: Dinero): boolean => d.centavos > 0;
export const esNegativo = (d: Dinero): boolean => d.centavos < 0;

export function minimo(a: Dinero, b: Dinero): Dinero {
  return comparar(a, b) <= 0 ? a : b;
}

export function maximo(a: Dinero, b: Dinero): Dinero {
  return comparar(a, b) >= 0 ? a : b;
}

// --- Presentación ---------------------------------------------------------------------

const SIMBOLO: Record<Moneda, string> = { BOB: 'Bs', USD: '$us' };

/** `formatear(Bs 600000 centavos)` → `"Bs 6.000,00"`. Convención boliviana. */
export function formatear(d: Dinero, opciones?: { sinSimbolo?: boolean }): string {
  const negativo = d.centavos < 0;
  const absoluto = Math.abs(d.centavos);
  const unidades = Math.trunc(absoluto / 100);
  const centesimos = absoluto % 100;

  const conMiles = String(unidades).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const numero = `${conMiles},${String(centesimos).padStart(2, '0')}`;
  const signo = negativo ? '-' : '';

  return opciones?.sinSimbolo ? `${signo}${numero}` : `${signo}${SIMBOLO[d.moneda]} ${numero}`;
}

export function nombreMoneda(moneda: Moneda): string {
  return moneda === 'BOB' ? 'Bolivianos' : 'Dólares';
}
