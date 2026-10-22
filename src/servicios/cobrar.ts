/**
 * Registrar un cobro.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`). Escribe el pago, sus
 * imputaciones, el saldo de cada obligación, el asiento del libro y el movimiento de caja.
 * Un cobro que insertó el pago pero no sus imputaciones deja la cartera inconsistente.
 *
 * El pago no edita saldos a mano: genera **imputaciones**, y el saldo de cada obligación se
 * deriva de ellas. Así, cuando alguien dice "yo te pagué", el libro lo puede demostrar.
 */

import {
  desgloseDeImputacion,
  imputarConReparto,
  imputarPago,
  type Imputacion,
  type Reparto,
} from '../dominio/imputacion';
import type { Componente, MedioPago } from '../dominio/tipos';
import { esPositivo, formatear, type Dinero } from '../nucleo/dinero';
import { MontoInvalidoError, PrestamoNoActivoError, SinDeudaError } from '../nucleo/errores';
import type { Dia, Instante } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { leerConfiguracion, ordenComponentesDe } from '../datos/repositorios/config';
import {
  aplicarImputacion,
  obligacionesCobrablesDePrestamo,
} from '../datos/repositorios/obligaciones';
import { cambiarEstadoPrestamo, exigirPrestamo } from '../datos/repositorios/prestamos';
import { registrarMovimiento, registrarMovimientoDeCaja } from './libro';

export type ParametrosCobro = {
  readonly prestamoId: number;
  readonly monto: Dinero;
  readonly fecha: Dia;
  readonly medio: MedioPago;
  readonly nota?: string | null;
  /** Para imputar en un orden distinto al configurado, en un pago puntual. */
  readonly componentes?: readonly Componente[];
  /**
   * El reparto que eligió el usuario ("todo a capital"). Si viene, manda sobre el orden de
   * componentes, y tiene que sumar exactamente el monto.
   */
  readonly reparto?: Reparto;
  readonly autor?: string;
  readonly ahora: Instante;
};

export type ResultadoCobro = {
  readonly pagoId: number;
  readonly imputaciones: readonly Imputacion[];
  readonly desglose: Record<Componente, Dinero>;
  readonly aplicado: Dinero;
  readonly sobrante: Dinero;
  readonly prestamoCerrado: boolean;
};

export async function cobrar(
  db: EjecutorSQL,
  params: ParametrosCobro,
): Promise<ResultadoCobro> {
  const prestamo = await exigirPrestamo(db, params.prestamoId);
  if (prestamo.estado !== 'activo') {
    throw new PrestamoNoActivoError(
      `El préstamo ${prestamo.id} está "${prestamo.estado}" y no admite cobros.`,
    );
  }

  const obligaciones = await obligacionesCobrablesDePrestamo(db, prestamo.id);
  if (obligaciones.length === 0) {
    throw new SinDeudaError(`El préstamo ${prestamo.id} no tiene deuda abierta.`);
  }

  const configuracion = await leerConfiguracion(db);
  const componentes = params.componentes ?? ordenComponentesDe(configuracion);
  const imputacionManual = params.componentes !== undefined || params.reparto !== undefined;

  let resultado;
  if (params.reparto) {
    resultado = imputarConReparto({
      reparto: params.reparto,
      obligaciones,
      hasta: params.fecha,
    });
    if (resultado.aplicado.centavos !== params.monto.centavos) {
      throw new MontoInvalidoError(
        `El reparto suma ${formatear(resultado.aplicado)} y el pago es de ${formatear(params.monto)}.`,
      );
    }
  } else {
    resultado = imputarPago({
      monto: params.monto,
      obligaciones,
      hasta: params.fecha,
      componentes,
    });
  }

  const moneda = params.monto.moneda;
  const desglose = desgloseDeImputacion(resultado, moneda);

  const pago = await db.runAsync(
    `INSERT INTO pagos
       (cliente_id, prestamo_id, fecha, moneda, monto_centavos, medio,
        sobrante_centavos, imputacion_manual, nota, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    prestamo.clienteId,
    prestamo.id,
    params.fecha,
    moneda,
    params.monto.centavos,
    params.medio,
    resultado.sobrante.centavos,
    imputacionManual ? 1 : 0,
    params.nota?.trim() ?? null,
    params.ahora,
  );
  const pagoId = pago.lastInsertRowId;

  for (const imputacion of resultado.imputaciones) {
    await db.runAsync(
      `INSERT INTO imputaciones (pago_id, obligacion_id, componente, monto_centavos, creado_en)
       VALUES (?, ?, ?, ?, ?)`,
      pagoId,
      imputacion.obligacionId,
      imputacion.componente,
      imputacion.monto.centavos,
      params.ahora,
    );
    await aplicarImputacion(
      db,
      imputacion.obligacionId,
      imputacion.componente,
      imputacion.monto,
      params.ahora,
    );
  }

  await registrarMovimiento(
    db,
    {
      tipo: 'pago',
      fecha: params.fecha,
      clienteId: prestamo.clienteId,
      prestamoId: prestamo.id,
      pagoId,
      moneda,
      capital: desglose.capital,
      interes: desglose.interes,
      mora: desglose.mora,
      detalle: params.nota?.trim() ?? null,
      autor: params.autor,
    },
    params.ahora,
  );

  // Solo el efectivo entra a la caja: una transferencia o un QR no están en el bolsillo, y
  // meterlos haría que el arqueo nunca cuadre contra lo contado.
  if (params.medio === 'efectivo') {
    await registrarMovimientoDeCaja(
      db,
      {
        tipo: 'cobro',
        fecha: params.fecha,
        monto: params.monto,
        pagoId,
        prestamoId: prestamo.id,
        detalle: params.nota?.trim() ?? null,
      },
      params.ahora,
    );
  }

  // Si no quedó nada por cobrar, el préstamo se cierra. No se borra: queda en el historial.
  const pendientes = await obligacionesCobrablesDePrestamo(db, prestamo.id);
  const prestamoCerrado = pendientes.length === 0;
  if (prestamoCerrado) {
    await cambiarEstadoPrestamo(db, prestamo.id, 'pagado', 'Saldado en su totalidad', params.ahora);
  }

  return {
    pagoId,
    imputaciones: resultado.imputaciones,
    desglose,
    aplicado: resultado.aplicado,
    sobrante: resultado.sobrante,
    prestamoCerrado,
  };
}

/** Advertencia útil para la pantalla: sobró plata porque ya no había deuda. */
export const huboSobrante = (resultado: ResultadoCobro): boolean =>
  esPositivo(resultado.sobrante);
