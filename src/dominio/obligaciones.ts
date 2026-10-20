/**
 * Operaciones sobre obligaciones.
 *
 * La obligación es la unidad de cobro: una cuota, un interés devengado, el capital, o la
 * mora de un atraso. Tiene hasta tres componentes (mora, interés, capital) y cada tipo usa
 * los que le corresponden.
 *
 * El saldo de una obligación **se deriva** de lo pagado, no se guarda editándolo. El libro
 * de movimientos es la verdad; cualquier saldo guardado es una copia que tiene que poder
 * reconstruirse desde cero.
 */

import { cero, esPositivo, restar, sumar, type Dinero } from '../nucleo/dinero';
import { diasEntre, esPosterior, type Dia } from '../nucleo/fechas';
import type { Componente, EstadoObligacion, Obligacion } from './tipos';
import { COMPONENTES } from './tipos';

/** Lo pactado de un componente. */
export function totalDe(o: Obligacion, componente: Componente): Dinero {
  switch (componente) {
    case 'mora':
      return o.mora;
    case 'interes':
      return o.interes;
    case 'capital':
      return o.capital;
  }
}

/** Lo ya cobrado de un componente. */
export function pagadoDe(o: Obligacion, componente: Componente): Dinero {
  switch (componente) {
    case 'mora':
      return o.pagadoMora;
    case 'interes':
      return o.pagadoInteres;
    case 'capital':
      return o.pagadoCapital;
  }
}

/** Lo que falta cobrar de un componente. Nunca negativo. */
export function saldoDe(o: Obligacion, componente: Componente): Dinero {
  const saldo = restar(totalDe(o, componente), pagadoDe(o, componente));
  return esPositivo(saldo) ? saldo : cero(o.moneda);
}

export function totalObligacion(o: Obligacion): Dinero {
  return sumar(o.capital, o.interes, o.mora);
}

export function pagadoObligacion(o: Obligacion): Dinero {
  return sumar(o.pagadoCapital, o.pagadoInteres, o.pagadoMora);
}

export function saldoObligacion(o: Obligacion): Dinero {
  return sumar(...COMPONENTES.map((componente) => saldoDe(o, componente)));
}

/** Se le puede imputar un pago: no está pagada, ni condonada, ni anulada. */
export function estaCobrable(o: Obligacion): boolean {
  return o.estado === 'pendiente' || o.estado === 'parcial';
}

/**
 * Está vencida al día `hasta`.
 *
 * Una obligación de capital sin fecha **nunca está vencida** — es la consecuencia de no
 * ponerle plazo, y es justo por eso que todo préstamo debería llevar una.
 */
export function estaVencida(o: Obligacion, hasta: Dia): boolean {
  if (o.vencimiento === null) return false;
  return esPosterior(hasta, o.vencimiento);
}

/** Días de atraso al día `hasta`. Cero si no venció o si no tiene fecha. */
export function diasDeAtraso(o: Obligacion, hasta: Dia): number {
  if (o.vencimiento === null) return 0;
  return Math.max(0, diasEntre(o.vencimiento, hasta));
}

/**
 * El estado que le corresponde según lo cobrado.
 *
 * Los estados que son una decisión —condonada, anulada, refinanciada— no se recalculan: los
 * puso una persona por una razón, y un saldo no los puede revertir solo.
 */
const ESTADOS_DECIDIDOS: readonly EstadoObligacion[] = ['condonada', 'anulada', 'refinanciada'];

export function estadoSegunSaldo(o: Obligacion): EstadoObligacion {
  if (ESTADOS_DECIDIDOS.includes(o.estado)) return o.estado;
  if (!esPositivo(saldoObligacion(o))) return 'pagada';
  return esPositivo(pagadoObligacion(o)) ? 'parcial' : 'pendiente';
}

/** Saldo de capital del préstamo: lo que falta cobrar del componente capital. */
export function saldoCapital(obligaciones: Obligacion[], moneda: Obligacion['moneda']): Dinero {
  const cobrables = obligaciones.filter(estaCobrable);
  if (cobrables.length === 0) return cero(moneda);
  return sumar(...cobrables.map((o) => saldoDe(o, 'capital')));
}

export type ResumenDeuda = {
  readonly mora: Dinero;
  readonly interes: Dinero;
  readonly capital: Dinero;
  readonly total: Dinero;
  readonly vencido: Dinero;
};

/** Lo que el cliente debe hoy, desglosado. Es lo que la pantalla de cobro muestra arriba. */
export function resumenDeuda(
  obligaciones: Obligacion[],
  moneda: Obligacion['moneda'],
  hasta: Dia,
): ResumenDeuda {
  const cobrables = obligaciones.filter(estaCobrable);
  const porComponente = (componente: Componente): Dinero =>
    cobrables.length === 0
      ? cero(moneda)
      : sumar(...cobrables.map((o) => saldoDe(o, componente)));

  const vencidas = cobrables.filter((o) => estaVencida(o, hasta));

  return {
    mora: porComponente('mora'),
    interes: porComponente('interes'),
    capital: porComponente('capital'),
    total: cobrables.length === 0 ? cero(moneda) : sumar(...cobrables.map(saldoObligacion)),
    vencido: vencidas.length === 0 ? cero(moneda) : sumar(...vencidas.map(saldoObligacion)),
  };
}

/** Obligación vacía, para construir en memoria antes de persistir. */
export function obligacionNueva(
  base: Omit<
    Obligacion,
    'pagadoCapital' | 'pagadoInteres' | 'pagadoMora' | 'estado'
  >,
): Obligacion {
  return {
    ...base,
    pagadoCapital: cero(base.moneda),
    pagadoInteres: cero(base.moneda),
    pagadoMora: cero(base.moneda),
    estado: 'pendiente',
  };
}

/** Suma centavos a un componente, devolviendo una obligación nueva (nada se muta). */
export function conPagoAplicado(
  o: Obligacion,
  componente: Componente,
  monto: Dinero,
): Obligacion {
  const actualizada: Obligacion = {
    ...o,
    pagadoMora: componente === 'mora' ? sumar(o.pagadoMora, monto) : o.pagadoMora,
    pagadoInteres: componente === 'interes' ? sumar(o.pagadoInteres, monto) : o.pagadoInteres,
    pagadoCapital: componente === 'capital' ? sumar(o.pagadoCapital, monto) : o.pagadoCapital,
  };
  return { ...actualizada, estado: estadoSegunSaldo(actualizada) };
}

/**
 * Deshace lo aplicado a un componente: es la mitad que falta para poder anular un pago.
 *
 * Nunca baja de cero. Si el monto a quitar fuera mayor que lo cobrado, algo ya estaba mal
 * antes, y dejar el campo en negativo lo convertiría en un saldo imposible de interpretar.
 */
export function conPagoQuitado(
  o: Obligacion,
  componente: Componente,
  monto: Dinero,
): Obligacion {
  const quitar = (pagado: Dinero): Dinero => {
    const resultado = restar(pagado, monto);
    return esPositivo(resultado) ? resultado : cero(o.moneda);
  };

  const actualizada: Obligacion = {
    ...o,
    pagadoMora: componente === 'mora' ? quitar(o.pagadoMora) : o.pagadoMora,
    pagadoInteres: componente === 'interes' ? quitar(o.pagadoInteres) : o.pagadoInteres,
    pagadoCapital: componente === 'capital' ? quitar(o.pagadoCapital) : o.pagadoCapital,
  };
  return { ...actualizada, estado: estadoSegunSaldo(actualizada) };
}
