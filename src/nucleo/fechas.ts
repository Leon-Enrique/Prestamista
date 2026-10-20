/**
 * Fechas: un vencimiento NO es un instante.
 *
 * Dos tipos distintos, y confundirlos corre los vencimientos un día:
 *
 * - `Dia`      — día de calendario, `YYYY-MM-DD`. Sin hora, sin zona. Vencimientos, fecha
 *                de un cobro. El 15 de noviembre es el 15 de noviembre.
 * - `Instante` — momento exacto, ISO-8601. `creado_en`, `revertido_en`.
 *
 * Bolivia es UTC−4. Si un vencimiento se guarda como instante, el 15 a las 00:00 local es
 * el 14 a las 20:00 UTC, y el día que se compare contra UTC aparecen vencimientos corridos
 * un día — con mora cobrada de más a gente real. En `YYYY-MM-DD` el orden alfabético **es**
 * el orden cronológico, así que comparar días es comparar texto.
 *
 * Toda la aritmética de días usa `Date.UTC` internamente para que la zona del dispositivo
 * no pueda mover un resultado.
 */

import { DiaInvalidoError } from './errores';

export type Dia = string & { readonly __marca: 'Dia' };
export type Instante = string & { readonly __marca: 'Instante' };

const FORMATO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

// --- Construcción ---------------------------------------------------------------------

export function dia(texto: string): Dia {
  const coincidencia = FORMATO_DIA.exec(texto);
  if (!coincidencia) {
    throw new DiaInvalidoError(`"${texto}" no tiene el formato YYYY-MM-DD.`);
  }
  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const numeroDia = Number(coincidencia[3]);

  if (mes < 1 || mes > 12 || numeroDia < 1 || numeroDia > diasEnMes(anio, mes)) {
    throw new DiaInvalidoError(`"${texto}" no es una fecha que exista.`);
  }
  return texto as Dia;
}

export function armarDia(anio: number, mes: number, numeroDia: number): Dia {
  const mm = String(mes).padStart(2, '0');
  const dd = String(numeroDia).padStart(2, '0');
  return dia(`${anio}-${mm}-${dd}`);
}

/**
 * El día de hoy según el reloj del dispositivo.
 *
 * Usa los componentes **locales** a propósito. `new Date().toISOString().slice(0, 10)`
 * sería el bug clásico: a las 21:00 en Bolivia devolvería la fecha de mañana.
 *
 * Las funciones de `src/dominio/` nunca llaman a esto — reciben el día como parámetro, para
 * que se puedan probar y para poder reproducir el reclamo de un cliente a una fecha dada.
 */
export function hoy(): Dia {
  const ahoraLocal = new Date();
  return armarDia(ahoraLocal.getFullYear(), ahoraLocal.getMonth() + 1, ahoraLocal.getDate());
}

export function ahora(): Instante {
  return new Date().toISOString() as Instante;
}

// --- Partes y aritmética --------------------------------------------------------------

function partes(d: Dia): { anio: number; mes: number; numeroDia: number } {
  const coincidencia = FORMATO_DIA.exec(d)!;
  return {
    anio: Number(coincidencia[1]),
    mes: Number(coincidencia[2]),
    numeroDia: Number(coincidencia[3]),
  };
}

export function diasEnMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

function aMarcaUtc(d: Dia): number {
  const { anio, mes, numeroDia } = partes(d);
  return Date.UTC(anio, mes - 1, numeroDia);
}

const MS_POR_DIA = 86_400_000;

function desdeMarcaUtc(marca: number): Dia {
  const fecha = new Date(marca);
  return armarDia(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, fecha.getUTCDate());
}

export function sumarDias(d: Dia, cantidad: number): Dia {
  return desdeMarcaUtc(aMarcaUtc(d) + cantidad * MS_POR_DIA);
}

/** Días calendario de `desde` a `hasta`. Negativo si `hasta` es anterior. */
export function diasEntre(desde: Dia, hasta: Dia): number {
  return Math.round((aMarcaUtc(hasta) - aMarcaUtc(desde)) / MS_POR_DIA);
}

/**
 * Suma meses recortando al último día del mes destino: 31/01 + 1 mes = 28/02.
 *
 * **Importante para los cronogramas**: calculá siempre desde la fecha de origen
 * (`sumarMeses(origen, n)`), nunca encadenando mes a mes desde la cuota anterior. Si se
 * encadena, 31/01 → 28/02 → 28/03 pierde el ancla y todas las cuotas siguientes caen el 28.
 * Desde el origen, la tercera cuota vuelve a caer el 31/03, que es lo que se pactó.
 *
 * Para eso está `fechasPeriodicas()`, que no deja equivocarse.
 */
export function sumarMeses(d: Dia, cantidad: number): Dia {
  const { anio, mes, numeroDia } = partes(d);
  const mesesTotales = (anio * 12 + (mes - 1)) + cantidad;
  const anioDestino = Math.floor(mesesTotales / 12);
  const mesDestino = (mesesTotales % 12) + 1;
  const diaDestino = Math.min(numeroDia, diasEnMes(anioDestino, mesDestino));
  return armarDia(anioDestino, mesDestino, diaDestino);
}

export type Frecuencia = 'diaria' | 'semanal' | 'quincenal' | 'mensual';

export const DIAS_DE_FRECUENCIA: Record<Frecuencia, number> = {
  diaria: 1,
  semanal: 7,
  quincenal: 15,
  mensual: 30,
};

/** El vencimiento del período `numero` (1 = el primero) contado desde `origen`. */
export function vencimientoDePeriodo(origen: Dia, frecuencia: Frecuencia, numero: number): Dia {
  switch (frecuencia) {
    case 'mensual':
      return sumarMeses(origen, numero);
    case 'quincenal':
      return sumarDias(origen, 15 * numero);
    case 'semanal':
      return sumarDias(origen, 7 * numero);
    case 'diaria':
      return sumarDias(origen, numero);
  }
}

/**
 * Las `cantidad` fechas de vencimiento de un cronograma, todas medidas desde `origen`.
 * Usá esto en vez de iterar sumando, por lo explicado en `sumarMeses`.
 */
export function fechasPeriodicas(origen: Dia, frecuencia: Frecuencia, cantidad: number): Dia[] {
  const fechas: Dia[] = [];
  for (let numero = 1; numero <= cantidad; numero += 1) {
    fechas.push(vencimientoDePeriodo(origen, frecuencia, numero));
  }
  return fechas;
}

// --- Comparación ----------------------------------------------------------------------

export const comparar = (a: Dia, b: Dia): number => (a < b ? -1 : a > b ? 1 : 0);
export const esAnterior = (a: Dia, b: Dia): boolean => a < b;
export const esPosterior = (a: Dia, b: Dia): boolean => a > b;
export const esMismoDia = (a: Dia, b: Dia): boolean => a === b;

export function minimoDia(a: Dia, b: Dia): Dia {
  return a <= b ? a : b;
}

export function maximoDia(a: Dia, b: Dia): Dia {
  return a >= b ? a : b;
}

// --- Presentación ---------------------------------------------------------------------

const MESES_CORTOS = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** `"2026-11-15"` → `"15/11/2026"`. */
export function formatearDia(d: Dia): string {
  const { anio, mes, numeroDia } = partes(d);
  return `${String(numeroDia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
}

/** `"2026-11-15"` → `"15 nov 2026"`, para listas donde el formato corto se lee mejor. */
export function formatearDiaCorto(d: Dia): string {
  const { anio, mes, numeroDia } = partes(d);
  return `${numeroDia} ${MESES_CORTOS[mes - 1]} ${anio}`;
}
