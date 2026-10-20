/**
 * Cálculo de interés.
 *
 * Dos convenciones del módulo, elegidas una vez y documentadas acá porque dentro de seis
 * meses nadie se acuerda y una fórmula mal interpretada se "arregla" rompiéndola:
 *
 * 1. **Base comercial 30/360.** Un mes son 30 días y un año 360. Es el estándar del rubro y
 *    evita que febrero rinda menos que enero por tener menos días.
 * 2. **Una semana es un cuarto de mes** (7,5 días de base), no 7 de 30. Así 4 cuotas
 *    semanales son exactamente un mes: 10% mensual sobre Bs 800 en 4 semanas son Bs 80, no
 *    Bs 74,67 como daría contar 28 días. Es como lo piensa quien presta por semana.
 * 3. **Conversión proporcional, no compuesta.** 10% mensual cobrado cada quincena es 5%
 *    quincenal, no el equivalente compuesto (4,88%). Es lo que el cliente entiende y lo que
 *    se pacta de palabra; usar el compuesto cobraría de más en silencio.
 *
 * El interés corriente se calcula **siempre sobre el saldo de capital**. El interés impago
 * no se suma al capital y no genera interés: capitalizar hace que la deuda crezca
 * exponencialmente y una deuda así no se cobra nunca. Lo que se cobra por el atraso es mora,
 * que vive en `mora.ts`.
 */

import { porTasa, proporcion, type Dinero, type PeriodoTasa, type Tasa } from '../nucleo/dinero';
import { DIAS_DE_FRECUENCIA, type Frecuencia } from '../nucleo/fechas';

const DIAS_BASE_TASA: Record<PeriodoTasa, number> = {
  diario: 1,
  semanal: 7.5,
  quincenal: 15,
  mensual: 30,
  anual: 360,
};

/**
 * Lleva la tasa al período de cobro, en puntos básicos.
 *
 * `puntosBasicosPorPeriodo(10% mensual, 'mensual')` → 1000
 * `puntosBasicosPorPeriodo(10% mensual, 'quincenal')` → 500
 */
export function puntosBasicosPorPeriodo(tasa: Tasa, frecuencia: Frecuencia): number {
  const diasDeLaTasa = DIAS_BASE_TASA[tasa.periodo];
  // Para el interés una semana pesa 7,5 días (un cuarto de mes); los vencimientos siguen
  // siendo cada 7 días reales.
  const diasDelPeriodo = frecuencia === 'semanal' ? 7.5 : DIAS_DE_FRECUENCIA[frecuencia];
  return Math.round((tasa.puntosBasicos * diasDelPeriodo) / diasDeLaTasa);
}

/** El interés de un período completo sobre el saldo de capital. */
export function interesDelPeriodo(
  saldoCapital: Dinero,
  tasa: Tasa,
  frecuencia: Frecuencia,
): Dinero {
  return porTasa(saldoCapital, puntosBasicosPorPeriodo(tasa, frecuencia));
}

/**
 * El interés de los días transcurridos de un período, para un pago adelantado.
 *
 * Bs 6.000 al 10% mensual, abona el capital el día 15 → interés de ese mes Bs 300, no
 * Bs 600. Es lo que hace un profesional y es lo que hace que el cliente vuelva.
 */
export function interesProrrateado(
  saldoCapital: Dinero,
  tasa: Tasa,
  frecuencia: Frecuencia,
  diasTranscurridos: number,
): Dinero {
  const diasDelPeriodo = DIAS_DE_FRECUENCIA[frecuencia];
  const diasACobrar = Math.max(0, Math.min(diasTranscurridos, diasDelPeriodo));
  return proporcion(
    interesDelPeriodo(saldoCapital, tasa, frecuencia),
    diasACobrar,
    diasDelPeriodo,
  );
}

/**
 * Tasa equivalente anual, solo para mostrar.
 *
 * Proporcional, igual que el resto del módulo: 10% mensual se informa como 120% anual. No es
 * la tasa efectiva compuesta (que sería 213%), y la pantalla debe decir "anual simple" para
 * no confundir.
 */
export function puntosBasicosAnuales(tasa: Tasa): number {
  return Math.round((tasa.puntosBasicos * 360) / DIAS_BASE_TASA[tasa.periodo]);
}
