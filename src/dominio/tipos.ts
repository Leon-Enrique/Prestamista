/**
 * Tipos del dominio de préstamos.
 *
 * `src/dominio/` es **código puro**: no importa SQLite, ni React, ni lee el reloj. Son
 * funciones que reciben números y fechas y devuelven números y fechas. El producto de esta
 * app *es* la aritmética, y una aritmética de dinero que no se puede probar es una que no se
 * puede confiar.
 */

import type { Dinero, Moneda, Tasa } from '../nucleo/dinero';
import type { Dia, Frecuencia } from '../nucleo/fechas';

// --- Modalidades ----------------------------------------------------------------------

/**
 * Cómo se generan las obligaciones de un préstamo.
 *
 * - `solo_interes`  — interés cada período sobre el saldo de **capital**; el capital es una
 *                     obligación aparte. Es lo que el usuario hace: Bs 6.000 al 10% mensual
 *                     son Bs 600 por mes mientras el capital esté colocado.
 * - `cuota_fija`    — sistema francés: la cuota total es igual todos los períodos, el
 *                     interés va sobre saldo y baja, el capital sube.
 * - `capital_fijo`  — sistema alemán: capital constante, interés sobre saldo, cuota baja.
 * - `interes_flat`  — interés sobre el **capital original**, repartido en cuotas iguales.
 *                     A la misma tasa rinde más que el francés; no son lo mismo.
 * - `pago_unico`    — capital + interés de todos los períodos, todo junto al vencimiento.
 */
export type Modalidad =
  | 'solo_interes'
  | 'cuota_fija'
  | 'capital_fijo'
  | 'interes_flat'
  | 'pago_unico';

/**
 * Las dos familias. Las dos producen obligaciones por cobrar, y el cobro, la mora y los
 * reportes trabajan sobre obligaciones sin preguntar de cuál vienen — ahí está la
 * versatilidad del sistema.
 */
export type Familia = 'cronograma_cerrado' | 'devengo_abierto';

export function familiaDe(modalidad: Modalidad): Familia {
  return modalidad === 'solo_interes' ? 'devengo_abierto' : 'cronograma_cerrado';
}

export const ETIQUETA_MODALIDAD: Record<Modalidad, string> = {
  solo_interes: 'Paga como puede',
  cuota_fija: 'Cuota fija',
  capital_fijo: 'Capital fijo',
  interes_flat: 'Interés fijo',
  pago_unico: 'Pago único',
};

export const DESCRIPCION_MODALIDAD: Record<Modalidad, string> = {
  solo_interes:
    'Paga el interés cada período y el capital cuando puede. El capital no baja hasta que lo abone.',
  cuota_fija: 'Paga siempre lo mismo. El interés va sobre el saldo que queda.',
  capital_fijo: 'Devuelve el capital en partes iguales. La cuota arranca alta y va bajando.',
  interes_flat:
    'El interés se calcula sobre el monto prestado y no baja. Rinde más que la cuota fija.',
  pago_unico: 'Devuelve todo junto al final: capital más el interés de todos los períodos.',
};

// --- Préstamo -------------------------------------------------------------------------

export type Condiciones = {
  readonly capital: Dinero;
  readonly tasa: Tasa;
  readonly modalidad: Modalidad;
  readonly frecuencia: Frecuencia;
  /** Cantidad de períodos del cronograma. `null` en un préstamo sin plazo definido. */
  readonly cantidadPeriodos: number | null;
  readonly fechaDesembolso: Dia;
  /**
   * Cuándo se exige el capital. `null` = préstamo sin vencimiento.
   *
   * Si el capital no tiene fecha nunca está vencido, así que nunca se puede reclamar ni
   * devengar mora sobre él, y el préstamo se vuelve permanente por omisión. Se admite
   * `null` porque es como se opera hoy, pero la cartera lo marca.
   */
  readonly vencimientoCapital: Dia | null;
};

export type EstadoPrestamo =
  | 'activo'
  | 'pagado'
  | 'refinanciado'
  | 'garantia_ejecutada'
  | 'incobrable'
  | 'anulado';

// --- Obligaciones ---------------------------------------------------------------------

/**
 * Qué clase de obligación es. Una obligación tiene hasta tres componentes y cada tipo usa
 * los que le corresponden:
 *
 * - `cuota`   — capital + interés en un solo vencimiento (familia cronograma cerrado)
 * - `interes` — interés devengado de un período (familia devengo abierto)
 * - `capital` — el capital a devolver, como obligación propia
 * - `mora`    — penalidad por el atraso de otra obligación
 */
export type TipoObligacion = 'cuota' | 'interes' | 'capital' | 'mora';

export type Componente = 'mora' | 'interes' | 'capital';

export const COMPONENTES: readonly Componente[] = ['mora', 'interes', 'capital'];

/**
 * `refinanciada` quiere decir que la deuda **se mudó** a otro préstamo: nadie la pagó ni la
 * perdonó. Distinguirlo importa para no confundir "deuda trasladada" con "anulada por error".
 */
export type EstadoObligacion =
  | 'pendiente'
  | 'parcial'
  | 'pagada'
  | 'condonada'
  | 'anulada'
  | 'refinanciada';

export type Obligacion = {
  readonly id: number;
  readonly prestamoId: number;
  readonly tipo: TipoObligacion;
  /** Número de cuota o de período devengado. `null` en la obligación de capital. */
  readonly numero: number | null;
  /** `null` solo en un capital sin vencimiento. */
  readonly vencimiento: Dia | null;
  readonly moneda: Moneda;

  readonly capital: Dinero;
  readonly interes: Dinero;
  readonly mora: Dinero;

  readonly pagadoCapital: Dinero;
  readonly pagadoInteres: Dinero;
  readonly pagadoMora: Dinero;

  readonly estado: EstadoObligacion;
  /** En una obligación de mora, cuál es la obligación atrasada que la originó. */
  readonly obligacionOrigenId: number | null;
};

// --- Entidades ------------------------------------------------------------------------

export type Cliente = {
  readonly id: number;
  readonly nombre: string;
  /** No es único ni obligatorio: se le presta a gente sin documento a mano. */
  readonly ci: string | null;
  readonly telefono: string | null;
  readonly direccion: string | null;
  readonly referencias: string | null;
  readonly notas: string | null;
  readonly activo: boolean;
};

export type Prestamo = {
  readonly id: number;
  readonly clienteId: number;
  readonly condiciones: Condiciones;
  /** `null` = usa las reglas generales de `config`. */
  readonly reglasMora: ReglasMora | null;
  readonly estado: EstadoPrestamo;
  /** Si este préstamo nació de refinanciar otro, cuál era. */
  readonly prestamoOrigenId: number | null;
  readonly motivoCierre: string | null;
  readonly notas: string | null;
};

export type MedioPago = 'efectivo' | 'transferencia' | 'qr' | 'otro';

export const MEDIOS_DE_PAGO: readonly MedioPago[] = [
  'efectivo',
  'transferencia',
  'qr',
  'otro',
];

/** Una línea de cronograma, antes de existir como fila en la base. */
export type LineaCronograma = {
  readonly numero: number;
  readonly vencimiento: Dia;
  readonly capital: Dinero;
  readonly interes: Dinero;
  /** Saldo de capital que queda después de pagar esta línea. */
  readonly saldoCapital: Dinero;
};

// --- Reglas configurables -------------------------------------------------------------

/**
 * Cómo se cobra la mora. Vive en `config`, no en el código, y cada préstamo puede
 * sobrescribirla.
 *
 * El tope existe porque una mora diaria sin techo es justo lo que vuelve impagable una deuda
 * chica — y una deuda impagable no se cobra: se pierde el capital.
 */
export type ReglasMora = {
  readonly tipo: 'porcentaje_diario' | 'monto_fijo_diario';
  /** Para `porcentaje_diario`: puntos básicos por día sobre el monto vencido. 50 pb = 0,5%. */
  readonly puntosBasicosDiarios: number;
  /** Para `monto_fijo_diario`: centavos por día de atraso. */
  readonly centavosDiarios: number;
  readonly diasDeGracia: number;
  /** Techo de la mora como puntos básicos del monto vencido. 2000 pb = 20%. */
  readonly topePuntosBasicos: number;
};

/**
 * "Sin penalización": reglas con techo 0, que dan siempre un monto de cero. Así un préstamo
 * puede optar por no cobrar penalización sin una columna nueva en la base.
 */
export const REGLAS_SIN_PENALIZACION: ReglasMora = {
  tipo: 'porcentaje_diario',
  puntosBasicosDiarios: 0,
  centavosDiarios: 0,
  diasDeGracia: 0,
  topePuntosBasicos: 0,
};

export const REGLAS_MORA_POR_DEFECTO: ReglasMora = {
  tipo: 'porcentaje_diario',
  puntosBasicosDiarios: 50,
  centavosDiarios: 0,
  diasDeGracia: 3,
  topePuntosBasicos: 2000,
};

/**
 * Orden en que un pago cubre los componentes **dentro de una obligación**.
 *
 * El recorrido es obligación por obligación, lo vencido antes que lo corriente y lo más
 * viejo primero, agotando cada obligación antes de pasar a la siguiente (ver
 * `imputacion.ts`). Así un pago de Bs 750 sobre cuotas de Bs 300 deja "dos cuotas y media",
 * que es lo que se anota en el cuaderno y lo que el cliente entiende.
 */
export const ORDEN_COMPONENTES_POR_DEFECTO: readonly Componente[] = [
  'mora',
  'interes',
  'capital',
];

/** Qué pasa con el interés del período en curso cuando se abona capital antes de tiempo. */
export type ReglaPagoAdelantado = 'prorratear_por_dias' | 'cobrar_periodo_completo';

export const REGLA_PAGO_ADELANTADO_POR_DEFECTO: ReglaPagoAdelantado = 'prorratear_por_dias';
