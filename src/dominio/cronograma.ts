/**
 * Generación de cronogramas.
 *
 * Solo para la familia **cronograma cerrado**: al desembolsar se conocen todas las cuotas,
 * con fecha, capital e interés. La familia **devengo abierto** (`solo_interes`) no tiene
 * cronograma: sus obligaciones las genera el devengo período a período sobre el saldo
 * vigente, porque si el cliente abona capital a mitad de camino el interés de los períodos
 * siguientes cambia, y un cronograma pregenerado quedaría mintiendo.
 *
 * Una vez generado, **el cronograma se guarda y se puede editar con rastro**. No es una
 * función que se vuelva a evaluar cada vez que se abre la pantalla: en la vida real se
 * negocia ("este mes pagame 200 menos"), y si el cronograma se recalculara desde los
 * parámetros nada de eso se podría representar — peor, cambiar la tasa de un préstamo viejo
 * movería cuotas ya cobradas.
 *
 * El redondeo de todo cronograma cierra exacto: la suma de las cuotas es exactamente capital
 * + interés total, porque la diferencia va a la última cuota (ver `repartir` en
 * `nucleo/dinero.ts`). Sin eso al cliente le queda una deuda de centavos para siempre.
 */

import {
  cero,
  comparar,
  dinero,
  maximo,
  minimo,
  porEntero,
  porTasa,
  repartir,
  restar,
  sumar,
  type Dinero,
} from '../nucleo/dinero';
import { ErrorDeNegocio } from '../nucleo/errores';
import { fechasPeriodicas, vencimientoDePeriodo } from '../nucleo/fechas';
import { puntosBasicosPorPeriodo } from './interes';
import { familiaDe, type Condiciones, type LineaCronograma } from './tipos';

export class CronogramaInvalidoError extends ErrorDeNegocio {}

function exigirCondicionesDeCronograma(c: Condiciones): number {
  if (familiaDe(c.modalidad) === 'devengo_abierto') {
    throw new CronogramaInvalidoError(
      `La modalidad "${c.modalidad}" no tiene cronograma: sus obligaciones las genera el ` +
        'devengo sobre el saldo vigente. Para mostrar una proyección usá proyectarSoloInteres().',
    );
  }
  if (c.cantidadPeriodos === null || c.cantidadPeriodos < 1) {
    throw new CronogramaInvalidoError(
      'Un cronograma cerrado necesita una cantidad de períodos de al menos 1.',
    );
  }
  if (c.capital.centavos <= 0) {
    throw new CronogramaInvalidoError('El capital de un préstamo debe ser mayor a cero.');
  }
  return c.cantidadPeriodos;
}

export function generarCronograma(c: Condiciones): LineaCronograma[] {
  const periodos = exigirCondicionesDeCronograma(c);
  const puntosBasicos = puntosBasicosPorPeriodo(c.tasa, c.frecuencia);

  switch (c.modalidad) {
    case 'cuota_fija':
      return cronogramaCuotaFija(c, periodos, puntosBasicos);
    case 'capital_fijo':
      return cronogramaCapitalFijo(c, periodos, puntosBasicos);
    case 'interes_flat':
      return cronogramaInteresFlat(c, periodos, puntosBasicos);
    case 'pago_unico':
      return cronogramaPagoUnico(c, periodos, puntosBasicos);
    default:
      throw new CronogramaInvalidoError(`Modalidad sin cronograma: ${c.modalidad}`);
  }
}

/**
 * Sistema francés: cuota total constante, interés sobre saldo.
 *
 * El factor de anualidad es el único lugar del proyecto donde aparece un decimal, y es
 * inevitable: `i / (1 - (1+i)^-n)` no es racional. Se redondea a centavos de inmediato y
 * **toda la acumulación posterior es entera**, así que el error no se propaga. La última
 * cuota amortiza el saldo que quede, de modo que el cronograma cierra exacto.
 */
function cronogramaCuotaFija(
  c: Condiciones,
  periodos: number,
  puntosBasicos: number,
): LineaCronograma[] {
  const fechas = fechasPeriodicas(c.fechaDesembolso, c.frecuencia, periodos);

  let cuotaTotal: Dinero;
  if (puntosBasicos === 0) {
    cuotaTotal = dinero(Math.round(c.capital.centavos / periodos), c.capital.moneda);
  } else {
    const i = puntosBasicos / 10_000;
    const factor = i / (1 - Math.pow(1 + i, -periodos));
    cuotaTotal = dinero(Math.round(c.capital.centavos * factor), c.capital.moneda);
  }

  const lineas: LineaCronograma[] = [];
  let saldo = c.capital;

  for (let numero = 1; numero <= periodos; numero += 1) {
    const interes = porTasa(saldo, puntosBasicos);
    const esUltima = numero === periodos;
    const capital = esUltima
      ? saldo
      : minimo(maximo(restar(cuotaTotal, interes), cero(saldo.moneda)), saldo);
    saldo = restar(saldo, capital);
    lineas.push({ numero, vencimiento: fechas[numero - 1], capital, interes, saldoCapital: saldo });
  }

  return lineas;
}

/** Sistema alemán: capital en partes iguales, interés sobre saldo, cuota decreciente. */
function cronogramaCapitalFijo(
  c: Condiciones,
  periodos: number,
  puntosBasicos: number,
): LineaCronograma[] {
  const fechas = fechasPeriodicas(c.fechaDesembolso, c.frecuencia, periodos);
  const partesCapital = repartir(c.capital, periodos);

  const lineas: LineaCronograma[] = [];
  let saldo = c.capital;

  for (let numero = 1; numero <= periodos; numero += 1) {
    const interes = porTasa(saldo, puntosBasicos);
    const capital = partesCapital[numero - 1];
    saldo = restar(saldo, capital);
    lineas.push({ numero, vencimiento: fechas[numero - 1], capital, interes, saldoCapital: saldo });
  }

  return lineas;
}

/**
 * Interés sobre el capital original: el interés de cada período se calcula sobre el monto
 * prestado y no baja aunque el saldo baje.
 *
 * Es el más usado en el préstamo informal y a la misma tasa rinde bastante más que el
 * francés. No son dos formas de decir lo mismo, y por eso la modalidad se guarda y se
 * muestra siempre junto a la tasa.
 */
function cronogramaInteresFlat(
  c: Condiciones,
  periodos: number,
  puntosBasicos: number,
): LineaCronograma[] {
  const fechas = fechasPeriodicas(c.fechaDesembolso, c.frecuencia, periodos);
  const interesTotal = porEntero(porTasa(c.capital, puntosBasicos), periodos);
  const partesCapital = repartir(c.capital, periodos);
  const partesInteres = repartir(interesTotal, periodos);

  const lineas: LineaCronograma[] = [];
  let saldo = c.capital;

  for (let numero = 1; numero <= periodos; numero += 1) {
    const capital = partesCapital[numero - 1];
    saldo = restar(saldo, capital);
    lineas.push({
      numero,
      vencimiento: fechas[numero - 1],
      capital,
      interes: partesInteres[numero - 1],
      saldoCapital: saldo,
    });
  }

  return lineas;
}

/** Todo junto al final: capital + el interés simple de todos los períodos. */
function cronogramaPagoUnico(
  c: Condiciones,
  periodos: number,
  puntosBasicos: number,
): LineaCronograma[] {
  return [
    {
      numero: 1,
      vencimiento: vencimientoDePeriodo(c.fechaDesembolso, c.frecuencia, periodos),
      capital: c.capital,
      interes: porEntero(porTasa(c.capital, puntosBasicos), periodos),
      saldoCapital: cero(c.capital.moneda),
    },
  ];
}

/**
 * Proyección de un préstamo de solo interés, **para mostrar al armarlo**.
 *
 * No son obligaciones: el devengo real las genera período a período sobre el saldo vigente,
 * y si el cliente abona capital antes, estas cifras cambian. La pantalla tiene que decirlo.
 */
export function proyectarSoloInteres(c: Condiciones, periodos: number): LineaCronograma[] {
  if (c.modalidad !== 'solo_interes') {
    throw new CronogramaInvalidoError(
      `proyectarSoloInteres() es para la modalidad solo_interes, llegó "${c.modalidad}".`,
    );
  }
  const puntosBasicos = puntosBasicosPorPeriodo(c.tasa, c.frecuencia);
  const fechas = fechasPeriodicas(c.fechaDesembolso, c.frecuencia, periodos);
  const interes = porTasa(c.capital, puntosBasicos);

  return fechas.map((vencimiento, indice) => {
    const esUltima = indice === periodos - 1;
    const devuelveCapital = esUltima && c.vencimientoCapital !== null;
    return {
      numero: indice + 1,
      vencimiento,
      capital: devuelveCapital ? c.capital : cero(c.capital.moneda),
      interes,
      saldoCapital: devuelveCapital ? cero(c.capital.moneda) : c.capital,
    };
  });
}

export type ResumenCronograma = {
  readonly totalCapital: Dinero;
  readonly totalInteres: Dinero;
  readonly totalAPagar: Dinero;
  readonly cuotaMinima: Dinero;
  readonly cuotaMaxima: Dinero;
};

/**
 * Los números con los que se decide y que el cliente pregunta: cuánto es el interés en
 * bolivianos y cuánto se paga en total. La pantalla de alta de préstamo los muestra siempre,
 * junto al porcentaje — un porcentaje solo no le dice nada a nadie.
 */
export function resumenCronograma(lineas: LineaCronograma[]): ResumenCronograma {
  if (lineas.length === 0) {
    throw new CronogramaInvalidoError('Un cronograma vacío no tiene resumen.');
  }
  const totalCapital = sumar(...lineas.map((l) => l.capital));
  const totalInteres = sumar(...lineas.map((l) => l.interes));
  const totales = lineas.map((l) => sumar(l.capital, l.interes));

  return {
    totalCapital,
    totalInteres,
    totalAPagar: sumar(totalCapital, totalInteres),
    cuotaMinima: totales.reduce((a, b) => (comparar(a, b) <= 0 ? a : b), totales[0]),
    cuotaMaxima: totales.reduce((a, b) => (comparar(a, b) >= 0 ? a : b), totales[0]),
  };
}
