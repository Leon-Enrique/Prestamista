/**
 * El libro de movimientos y la caja.
 *
 * `movimientos` es de **solo inserción**: nunca `UPDATE`, nunca `DELETE`. Un error se
 * corrige con un asiento de reverso que apunta al original. No es purismo contable — es un
 * registro de deuda entre personas, y la única defensa cuando alguien dice "yo te pagué" es
 * un libro que no se pudo editar.
 *
 * Por eso los montos van **con signo**: un reverso es negativo. Las columnas del libro no
 * llevan `CHECK >= 0`, a diferencia de las obligaciones.
 */

import { cero, type Dinero, type Moneda } from '../nucleo/dinero';
import type { Dia, Instante } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';

export type TipoMovimiento =
  | 'desembolso'
  | 'devengo_interes'
  | 'devengo_mora'
  | 'pago'
  | 'condonacion'
  | 'reverso'
  | 'refinanciacion'
  | 'ajuste'
  | 'garantia';

export type TipoMovimientoCaja =
  | 'cobro'
  | 'desembolso'
  | 'retiro'
  | 'aporte'
  | 'gasto'
  | 'ajuste';

export const AUTOR_POR_DEFECTO = 'dueño';

export type AsientoLibro = {
  readonly tipo: TipoMovimiento;
  readonly fecha: Dia;
  readonly clienteId?: number | null;
  readonly prestamoId?: number | null;
  readonly obligacionId?: number | null;
  readonly pagoId?: number | null;
  readonly moneda?: Moneda | null;
  readonly capital?: Dinero;
  readonly interes?: Dinero;
  readonly mora?: Dinero;
  readonly movimientoRevertidoId?: number | null;
  readonly detalle?: string | null;
  readonly autor?: string;
};

export async function registrarMovimiento(
  db: EjecutorSQL,
  asiento: AsientoLibro,
  ahora: Instante,
): Promise<number> {
  const moneda = asiento.moneda ?? asiento.capital?.moneda ?? asiento.interes?.moneda ?? null;
  const nada = moneda ? cero(moneda) : null;

  const resultado = await db.runAsync(
    `INSERT INTO movimientos (
       tipo, fecha, cliente_id, prestamo_id, obligacion_id, pago_id, moneda,
       capital_centavos, interes_centavos, mora_centavos,
       movimiento_revertido_id, detalle, autor, creado_en
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    asiento.tipo,
    asiento.fecha,
    asiento.clienteId ?? null,
    asiento.prestamoId ?? null,
    asiento.obligacionId ?? null,
    asiento.pagoId ?? null,
    moneda,
    (asiento.capital ?? nada)?.centavos ?? 0,
    (asiento.interes ?? nada)?.centavos ?? 0,
    (asiento.mora ?? nada)?.centavos ?? 0,
    asiento.movimientoRevertidoId ?? null,
    asiento.detalle ?? null,
    asiento.autor ?? AUTOR_POR_DEFECTO,
    ahora,
  );
  return resultado.lastInsertRowId;
}

export type AsientoCaja = {
  readonly tipo: TipoMovimientoCaja;
  readonly fecha: Dia;
  /** Con signo: positivo entra a la caja, negativo sale. */
  readonly monto: Dinero;
  readonly pagoId?: number | null;
  readonly prestamoId?: number | null;
  readonly detalle?: string | null;
};

/**
 * Movimiento de caja: plata en la mano.
 *
 * Solo entra acá lo que es **efectivo**. Una transferencia o un QR no pasan por la caja, y
 * meterlos haría que el arqueo nunca cuadre contra lo que hay contado en el bolsillo.
 *
 * El desembolso de un préstamo **sale de la caja**. Si no se registra, nunca se sabe cuánto
 * capital real hay colocado frente a cuánto queda disponible.
 */
export async function registrarMovimientoDeCaja(
  db: EjecutorSQL,
  asiento: AsientoCaja,
  ahora: Instante,
): Promise<number> {
  const resultado = await db.runAsync(
    `INSERT INTO caja_movimientos
       (tipo, fecha, moneda, monto_centavos, pago_id, prestamo_id, detalle, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    asiento.tipo,
    asiento.fecha,
    asiento.monto.moneda,
    asiento.monto.centavos,
    asiento.pagoId ?? null,
    asiento.prestamoId ?? null,
    asiento.detalle ?? null,
    ahora,
  );
  return resultado.lastInsertRowId;
}
