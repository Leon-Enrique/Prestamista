/**
 * Anular un pago.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`).
 *
 * Equivocarse anotando un cobro —un monto mal tipeado, el cliente equivocado— es cosa de
 * todos los días, no un caso borde. Pero anular **no es borrar**: el recibo ya salió y el
 * cliente lo tiene, así que la fila del pago se queda y se marca como revertida, con su
 * motivo y su fecha, y el libro recibe un asiento de reverso que apunta al original.
 *
 * Las filas de `imputaciones` tampoco se borran. Lo que deja de contar es el pago entero, y
 * por eso toda consulta de ganancia filtra `revertido_en IS NULL`: un cobro anulado no es
 * ganancia.
 *
 * Anular y condonar son cosas distintas: anular es "ese pago no existió", condonar es
 * "existía la deuda y la perdono" (ver `condonar.ts`).
 */

import { negar, sumar, type Dinero } from '../nucleo/dinero';
import type { Dia, Instante } from '../nucleo/fechas';
import { cero } from '../nucleo/dinero';
import type { EjecutorSQL } from '../datos/ejecutor';
import { quitarImputacion } from '../datos/repositorios/obligaciones';
import {
  exigirPago,
  imputacionesDePago,
  marcarPagoRevertido,
  movimientoDePago,
  PagoYaRevertidoError,
} from '../datos/repositorios/pagos';
import { cambiarEstadoPrestamo, exigirPrestamo } from '../datos/repositorios/prestamos';
import type { Componente } from '../dominio/tipos';
import { registrarMovimiento, registrarMovimientoDeCaja } from './libro';

export type ResultadoReverso = {
  readonly pagoId: number;
  readonly desglose: Record<Componente, Dinero>;
  readonly total: Dinero;
  /** El préstamo estaba cerrado por este pago y volvió a quedar activo. */
  readonly prestamoReabierto: boolean;
};

export async function revertirPago(
  db: EjecutorSQL,
  params: {
    pagoId: number;
    motivo: string;
    fecha: Dia;
    autor?: string;
    ahora: Instante;
  },
): Promise<ResultadoReverso> {
  const pago = await exigirPago(db, params.pagoId);
  if (pago.revertidoEn !== null) {
    throw new PagoYaRevertidoError(
      `El pago ${pago.id} ya se anuló el ${pago.revertidoEn.slice(0, 10)}.`,
    );
  }

  const moneda = pago.monto.moneda;
  const imputaciones = await imputacionesDePago(db, pago.id);

  const desglose: Record<Componente, Dinero> = {
    mora: cero(moneda),
    interes: cero(moneda),
    capital: cero(moneda),
  };

  for (const imputacion of imputaciones) {
    await quitarImputacion(
      db,
      imputacion.obligacionId,
      imputacion.componente,
      imputacion.monto,
      params.ahora,
    );
    desglose[imputacion.componente] = sumar(
      desglose[imputacion.componente],
      imputacion.monto,
    );
  }

  await marcarPagoRevertido(db, pago.id, params.motivo, params.ahora);

  await registrarMovimiento(
    db,
    {
      tipo: 'reverso',
      fecha: params.fecha,
      clienteId: pago.clienteId,
      prestamoId: pago.prestamoId,
      pagoId: pago.id,
      moneda,
      // Negativos: el asiento deshace lo que hizo el original.
      capital: negar(desglose.capital),
      interes: negar(desglose.interes),
      mora: negar(desglose.mora),
      movimientoRevertidoId: await movimientoDePago(db, pago.id),
      detalle: `Pago anulado: ${params.motivo.trim() || 'sin motivo'}`,
      autor: params.autor,
    },
    params.ahora,
  );

  // La plata vuelve a salir de la caja solo si había entrado: una transferencia nunca entró.
  if (pago.medio === 'efectivo') {
    await registrarMovimientoDeCaja(
      db,
      {
        tipo: 'ajuste',
        fecha: params.fecha,
        monto: negar(pago.monto),
        pagoId: pago.id,
        prestamoId: pago.prestamoId,
        detalle: `Anulación de cobro: ${params.motivo.trim() || 'sin motivo'}`,
      },
      params.ahora,
    );
  }

  // Si el préstamo se había cerrado por este pago, vuelve a estar activo. Solo si estaba
  // "pagado": un préstamo refinanciado o con la garantía ejecutada se cerró por otra razón.
  let prestamoReabierto = false;
  if (pago.prestamoId !== null) {
    const prestamo = await exigirPrestamo(db, pago.prestamoId);
    if (prestamo.estado === 'pagado') {
      await cambiarEstadoPrestamo(
        db,
        prestamo.id,
        'activo',
        'Reabierto al anular un cobro',
        params.ahora,
      );
      prestamoReabierto = true;
    }
  }

  return {
    pagoId: pago.id,
    desglose,
    total: sumar(desglose.mora, desglose.interes, desglose.capital),
    prestamoReabierto,
  };
}
