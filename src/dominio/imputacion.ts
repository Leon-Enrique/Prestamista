/**
 * Imputación de pagos.
 *
 * El recorrido es **obligación por obligación**: lo vencido antes que lo corriente, lo más
 * viejo primero, y cada obligación se agota antes de pasar a la siguiente. Dentro de una
 * obligación el orden de los componentes es mora → interés → capital, y es configurable.
 *
 * Por qué así y no "todo el interés vencido primero, después todo el capital": con cuotas,
 * esa otra forma deja las cuatro cuotas parcialmente pagadas, y queda una cuota 4 con un
 * pago encima mientras la 3 sigue abierta — imposible de explicar al cliente. Recorriendo
 * por obligación, Bs 750 sobre cuotas de Bs 300 deja "dos cuotas y media", que es lo que se
 * anota en el cuaderno.
 *
 * Las obligaciones de mora se cobran antes que la obligación que penalizan cuando comparten
 * fecha, así el estándar "primero la mora" se cumple igual.
 *
 * **Un pago no edita nada.** Devuelve imputaciones (pago → obligación → componente → monto)
 * y el saldo que sobró. Quien las persiste es el servicio de cobro, en una sola transacción.
 * El saldo de cada obligación se deriva de sus imputaciones: así, cuando alguien dice "yo te
 * pagué", el libro lo puede demostrar.
 */

import { cero, dinero, esPositivo, restar, sumar, type Dinero } from '../nucleo/dinero';
import { MonedaIncompatibleError, MontoInvalidoError } from '../nucleo/errores';
import type { Dia } from '../nucleo/fechas';
import { estaCobrable, estaVencida, saldoDe } from './obligaciones';
import { ORDEN_COMPONENTES_POR_DEFECTO, type Componente, type Obligacion } from './tipos';

export type Imputacion = {
  readonly obligacionId: number;
  readonly componente: Componente;
  readonly monto: Dinero;
};

export type ResultadoImputacion = {
  readonly imputaciones: readonly Imputacion[];
  /** Lo que se alcanzó a aplicar a deuda. */
  readonly aplicado: Dinero;
  /**
   * Lo que sobró porque ya no había deuda. Queda a favor del cliente; **no se devuelve en
   * efectivo** sin que sea una operación explícita de caja.
   */
  readonly sobrante: Dinero;
};

/**
 * Orden de cobro: lo más viejo primero, la mora antes de lo que penaliza, y las obligaciones
 * sin fecha al final — un capital sin vencimiento no compite con una cuota que ya venció.
 */
function ordenarParaCobro(obligaciones: Obligacion[]): Obligacion[] {
  const prioridadDeTipo = (o: Obligacion): number => (o.tipo === 'mora' ? 0 : 1);

  return [...obligaciones].sort((a, b) => {
    if (a.vencimiento === null && b.vencimiento === null) return a.id - b.id;
    if (a.vencimiento === null) return 1;
    if (b.vencimiento === null) return -1;
    if (a.vencimiento !== b.vencimiento) return a.vencimiento < b.vencimiento ? -1 : 1;
    return (
      prioridadDeTipo(a) - prioridadDeTipo(b) ||
      (a.numero ?? 0) - (b.numero ?? 0) ||
      a.id - b.id
    );
  });
}

export function imputarPago(params: {
  monto: Dinero;
  obligaciones: readonly Obligacion[];
  hasta: Dia;
  componentes?: readonly Componente[];
}): ResultadoImputacion {
  const { monto, obligaciones, hasta } = params;
  const componentes = params.componentes ?? ORDEN_COMPONENTES_POR_DEFECTO;
  const moneda = monto.moneda;

  if (!esPositivo(monto)) {
    throw new MontoInvalidoError(
      'Un pago debe ser mayor a cero. Anular un pago es un asiento de reverso, no un pago negativo.',
    );
  }

  const distinta = obligaciones.find((o) => o.moneda !== moneda);
  if (distinta) {
    throw new MonedaIncompatibleError(
      `El pago es en ${moneda} y la obligación ${distinta.id} está en ${distinta.moneda}. ` +
        'Un préstamo no cambia de moneda; si hace falta, es una refinanciación.',
    );
  }

  const cobrables = ordenarParaCobro(obligaciones.filter(estaCobrable));
  const vencidas = cobrables.filter((o) => estaVencida(o, hasta));
  const corrientes = cobrables.filter((o) => !estaVencida(o, hasta));

  const imputaciones: Imputacion[] = [];
  let restante = monto.centavos;

  for (const obligacion of [...vencidas, ...corrientes]) {
    if (restante <= 0) break;

    for (const componente of componentes) {
      if (restante <= 0) break;

      const saldo = saldoDe(obligacion, componente).centavos;
      if (saldo <= 0) continue;

      const aAplicar = Math.min(restante, saldo);
      imputaciones.push({
        obligacionId: obligacion.id,
        componente,
        monto: dinero(aAplicar, moneda),
      });
      restante -= aAplicar;
    }
  }

  const aplicado =
    imputaciones.length === 0 ? cero(moneda) : sumar(...imputaciones.map((i) => i.monto));

  return { imputaciones, aplicado, sobrante: restar(monto, aplicado) };
}

/**
 * Lo que hace falta para dejar todo en cero. Es el monto que la pantalla de cobro ofrece
 * como "pagar todo".
 */
export function totalParaSaldar(
  obligaciones: readonly Obligacion[],
  moneda: Dinero['moneda'],
): Dinero {
  const cobrables = obligaciones.filter(estaCobrable);
  if (cobrables.length === 0) return cero(moneda);
  return sumar(
    ...cobrables.flatMap((o) => [
      saldoDe(o, 'mora'),
      saldoDe(o, 'interes'),
      saldoDe(o, 'capital'),
    ]),
  );
}

/** Cuánto del pago fue mora, cuánto interés y cuánto capital. */
export function desgloseDeImputacion(
  resultado: ResultadoImputacion,
  moneda: Dinero['moneda'],
): Record<Componente, Dinero> {
  const porComponente = (componente: Componente): Dinero => {
    const montos = resultado.imputaciones
      .filter((i) => i.componente === componente)
      .map((i) => i.monto);
    return montos.length === 0 ? cero(moneda) : sumar(...montos);
  };

  return {
    mora: porComponente('mora'),
    interes: porComponente('interes'),
    capital: porComponente('capital'),
  };
}
