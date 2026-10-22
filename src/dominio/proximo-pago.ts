/**
 * El próximo pago de un préstamo: cuándo vence y cuánto es de interés y de capital.
 *
 * - En "paga como puede" (devengo abierto) el próximo interés **todavía no existe** como
 *   obligación: se genera al cumplirse el período. Se proyecta igual que lo calculará el
 *   devengo, sobre el capital que se debe hoy; si el cliente abona capital antes, el monto
 *   baja solo.
 * - En los préstamos con cuotas, es la próxima cuota sin pagar (lo que falta de ella).
 */

import { cero, sumar, type Dinero } from '../nucleo/dinero';
import { comparar, vencimientoDePeriodo, type Dia } from '../nucleo/fechas';
import { interesDelPeriodo } from './interes';
import { estaCobrable, saldoDe, saldoObligacion } from './obligaciones';
import { familiaDe, type Condiciones, type Obligacion } from './tipos';

export type ProximoPago = {
  readonly fecha: Dia;
  readonly interes: Dinero;
  readonly capital: Dinero;
  readonly total: Dinero;
};

export function proximoPago(
  condiciones: Condiciones,
  obligaciones: readonly Obligacion[],
  hoy: Dia,
): ProximoPago | null {
  const moneda = condiciones.capital.moneda;
  const cobrables = obligaciones.filter(estaCobrable);

  if (familiaDe(condiciones.modalidad) === 'devengo_abierto') {
    const capital = sumar(cero(moneda), ...cobrables.map((o) => saldoDe(o, 'capital')));
    if (capital.centavos <= 0) return null;

    // El primer vencimiento que todavía no llegó: lo de hoy o antes ya lo generó el devengo.
    let numero = 1;
    let fecha = vencimientoDePeriodo(condiciones.fechaDesembolso, condiciones.frecuencia, numero);
    while (comparar(fecha, hoy) <= 0) {
      numero += 1;
      fecha = vencimientoDePeriodo(condiciones.fechaDesembolso, condiciones.frecuencia, numero);
    }
    const interes = interesDelPeriodo(capital, condiciones.tasa, condiciones.frecuencia);
    return { fecha, interes, capital: cero(moneda), total: interes };
  }

  const conFecha = cobrables
    .filter((o) => o.vencimiento !== null)
    .sort((a, b) => comparar(a.vencimiento!, b.vencimiento!));
  if (conFecha.length === 0) return null;

  // La próxima que vence desde hoy; si ya vencieron todas, la más vieja.
  const siguiente = conFecha.find((o) => comparar(o.vencimiento!, hoy) >= 0) ?? conFecha[0];
  return {
    fecha: siguiente.vencimiento!,
    interes: sumar(saldoDe(siguiente, 'interes'), saldoDe(siguiente, 'mora')),
    capital: saldoDe(siguiente, 'capital'),
    total: saldoObligacion(siguiente),
  };
}
