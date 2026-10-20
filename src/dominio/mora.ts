/**
 * Cálculo de mora.
 *
 * La mora se cobra sobre el **monto vencido**, por día de atraso, y nunca sobre capital que
 * todavía no venció — quien llama pasa el monto vencido, no el total de la deuda.
 *
 * Dos cosas que un prestamista profesional hace y que acá son obligatorias:
 *
 * - **Días de gracia.** Resuelven el "cobro a fin de mes o cuando me den" sin perder de
 *   vista quién está atrasado de verdad.
 * - **Un techo.** Una mora diaria sin tope es exactamente lo que vuelve impagable una deuda
 *   chica, y una deuda impagable no se cobra: se pierde el capital y se gana un conflicto.
 *
 * Acá los días son **días calendario reales**, no la base comercial 30/360 que usa el
 * interés (ver `interes.ts`): si se atrasó siete días, se atrasó siete días.
 *
 * La mora **se devenga y se guarda** como obligación propia; esta función es el cálculo que
 * usa el devengo. No la llames desde una pantalla para mostrar una mora que no existe como
 * obligación: si la mora se calculara al vuelo, cambiar el parámetro movería retroactivamente
 * moras de pagos ya cobrados y los meses cerrados dejarían de cuadrar.
 */

import { cero, dinero, minimo, porTasa, type Dinero } from '../nucleo/dinero';
import { diasEntre, type Dia } from '../nucleo/fechas';
import type { ReglasMora } from './tipos';

export type CalculoMora = {
  /** Días calendario desde el vencimiento. */
  readonly diasDeAtraso: number;
  /** Los que se cobran, ya descontados los días de gracia. */
  readonly diasCobrables: number;
  readonly monto: Dinero;
  /** El cálculo tocó el techo, así que la mora dejó de crecer. */
  readonly topeAlcanzado: boolean;
};

export function calcularMora(params: {
  montoVencido: Dinero;
  vencimiento: Dia;
  hasta: Dia;
  reglas: ReglasMora;
}): CalculoMora {
  const { montoVencido, vencimiento, hasta, reglas } = params;
  const moneda = montoVencido.moneda;

  const diasDeAtraso = Math.max(0, diasEntre(vencimiento, hasta));
  const diasCobrables = Math.max(0, diasDeAtraso - reglas.diasDeGracia);

  if (diasCobrables === 0 || montoVencido.centavos <= 0) {
    return { diasDeAtraso, diasCobrables, monto: cero(moneda), topeAlcanzado: false };
  }

  const bruta =
    reglas.tipo === 'porcentaje_diario'
      ? porTasa(montoVencido, reglas.puntosBasicosDiarios * diasCobrables)
      : dinero(reglas.centavosDiarios * diasCobrables, moneda);

  const techo = porTasa(montoVencido, reglas.topePuntosBasicos);
  const monto = minimo(bruta, techo);

  return {
    diasDeAtraso,
    diasCobrables,
    monto,
    topeAlcanzado: monto.centavos === techo.centavos && bruta.centavos > techo.centavos,
  };
}

/**
 * Cuánta mora falta devengar, dado lo ya devengado para esa obligación.
 *
 * El devengo es incremental e **idempotente**: corre cada vez que se abre la app y solo
 * agrega la diferencia. Devengar dos veces el mismo tramo duplicaría la deuda de una persona
 * real, que es el peor error que esta app puede cometer.
 */
export function moraPendienteDeDevengar(params: {
  montoVencido: Dinero;
  vencimiento: Dia;
  hasta: Dia;
  reglas: ReglasMora;
  yaDevengada: Dinero;
}): Dinero {
  const calculo = calcularMora(params);
  const diferencia = calculo.monto.centavos - params.yaDevengada.centavos;
  return diferencia > 0
    ? dinero(diferencia, params.montoVencido.moneda)
    : cero(params.montoVencido.moneda);
}
