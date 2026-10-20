import type { Componente, MedioPago } from '../../dominio/tipos';
import { dinero, type Dinero, type Moneda } from '../../nucleo/dinero';
import { ErrorDeNegocio } from '../../nucleo/errores';
import type { Dia, Instante } from '../../nucleo/fechas';
import type { EjecutorSQL } from '../ejecutor';

export class PagoInexistenteError extends ErrorDeNegocio {}
export class PagoYaRevertidoError extends ErrorDeNegocio {}

export type Pago = {
  readonly id: number;
  readonly clienteId: number;
  readonly prestamoId: number | null;
  readonly fecha: Dia;
  readonly monto: Dinero;
  readonly medio: MedioPago;
  readonly sobrante: Dinero;
  readonly imputacionManual: boolean;
  /** Si está revertido, ya no cuenta: ni como ganancia ni como baja de deuda. */
  readonly revertidoEn: Instante | null;
  readonly motivoReverso: string | null;
  readonly nota: string | null;
};

export type ImputacionGuardada = {
  readonly id: number;
  readonly pagoId: number;
  readonly obligacionId: number;
  readonly componente: Componente;
  readonly monto: Dinero;
};

type FilaPago = {
  id: number;
  cliente_id: number;
  prestamo_id: number | null;
  fecha: string;
  moneda: string;
  monto_centavos: number;
  medio: string;
  sobrante_centavos: number;
  imputacion_manual: number;
  revertido_en: string | null;
  motivo_reverso: string | null;
  nota: string | null;
};

const COLUMNAS = `
  id, cliente_id, prestamo_id, fecha, moneda, monto_centavos, medio,
  sobrante_centavos, imputacion_manual, revertido_en, motivo_reverso, nota
`;

function aPago(fila: FilaPago): Pago {
  const moneda = fila.moneda as Moneda;
  return {
    id: fila.id,
    clienteId: fila.cliente_id,
    prestamoId: fila.prestamo_id,
    fecha: fila.fecha as Dia,
    monto: dinero(fila.monto_centavos, moneda),
    medio: fila.medio as MedioPago,
    sobrante: dinero(fila.sobrante_centavos, moneda),
    imputacionManual: fila.imputacion_manual !== 0,
    revertidoEn: (fila.revertido_en as Instante | null) ?? null,
    motivoReverso: fila.motivo_reverso,
    nota: fila.nota,
  };
}

export async function obtenerPago(db: EjecutorSQL, id: number): Promise<Pago | null> {
  const fila = await db.getFirstAsync<FilaPago>(
    `SELECT ${COLUMNAS} FROM pagos WHERE id = ?`,
    id,
  );
  return fila ? aPago(fila) : null;
}

export async function exigirPago(db: EjecutorSQL, id: number): Promise<Pago> {
  const pago = await obtenerPago(db, id);
  if (!pago) throw new PagoInexistenteError(`No existe el pago ${id}.`);
  return pago;
}

/** Los pagos de un préstamo, del más reciente al más viejo. Incluye los revertidos. */
export async function pagosDePrestamo(db: EjecutorSQL, prestamoId: number): Promise<Pago[]> {
  const filas = await db.getAllAsync<FilaPago>(
    `SELECT ${COLUMNAS} FROM pagos WHERE prestamo_id = ? ORDER BY fecha DESC, id DESC`,
    prestamoId,
  );
  return filas.map(aPago);
}

export async function imputacionesDePago(
  db: EjecutorSQL,
  pagoId: number,
): Promise<ImputacionGuardada[]> {
  const filas = await db.getAllAsync<{
    id: number;
    pago_id: number;
    obligacion_id: number;
    componente: string;
    monto_centavos: number;
    moneda: string;
  }>(
    `SELECT i.id, i.pago_id, i.obligacion_id, i.componente, i.monto_centavos, p.moneda
       FROM imputaciones i
       JOIN pagos p ON p.id = i.pago_id
      WHERE i.pago_id = ?
      ORDER BY i.id`,
    pagoId,
  );

  return filas.map((fila) => ({
    id: fila.id,
    pagoId: fila.pago_id,
    obligacionId: fila.obligacion_id,
    componente: fila.componente as Componente,
    monto: dinero(fila.monto_centavos, fila.moneda as Moneda),
  }));
}

/**
 * Marca el pago como revertido. **No lo borra**: el recibo ya salió y el cliente lo tiene,
 * así que la historia tiene que mostrar que entró y que se anuló, con su motivo.
 */
export async function marcarPagoRevertido(
  db: EjecutorSQL,
  pagoId: number,
  motivo: string,
  ahora: Instante,
): Promise<void> {
  await db.runAsync(
    'UPDATE pagos SET revertido_en = ?, motivo_reverso = ? WHERE id = ?',
    ahora,
    motivo.trim() || 'Sin motivo',
    pagoId,
  );
}

/** El asiento del libro que corresponde a un pago, para poder apuntarle el reverso. */
export async function movimientoDePago(
  db: EjecutorSQL,
  pagoId: number,
): Promise<number | null> {
  const fila = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM movimientos WHERE tipo = 'pago' AND pago_id = ? ORDER BY id LIMIT 1",
    pagoId,
  );
  return fila?.id ?? null;
}
