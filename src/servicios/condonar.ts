/**
 * Condonar: perdonar una deuda que existe.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`).
 *
 * Perdonar la mora —"dale, te perdono los días"— es parte del oficio, y tiene que quedar
 * registrado: la obligación **no se borra**, se marca condonada con su motivo. Así se puede
 * ver cuánto se perdonó y a quién, que es información del negocio: si a un cliente se le
 * perdona mora todos los meses, esa mora en realidad no existe.
 *
 * Condonar y anular son cosas distintas: anular es "ese pago no existió", condonar es
 * "existía la deuda y la perdono" (ver `revertir.ts`).
 *
 * **El capital no se condona acá.** Perdonar capital es dar la plata por perdida, que es
 * cerrar el préstamo como incobrable: otra operación, con otro significado en los reportes.
 */

import { esPositivo, negar, type Dinero } from '../nucleo/dinero';
import { ErrorDeNegocio, ObligacionInexistenteError } from '../nucleo/errores';
import type { Dia, Instante } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import {
  condonarObligacion,
  obligacionesCobrablesDePrestamo,
  obtenerObligacion,
} from '../datos/repositorios/obligaciones';
import { cambiarEstadoPrestamo, exigirPrestamo } from '../datos/repositorios/prestamos';
import { saldoDe, saldoObligacion } from '../dominio/obligaciones';
import { registrarMovimiento } from './libro';

export class NoSePuedeCondonarError extends ErrorDeNegocio {}

export type ResultadoCondonacion = {
  readonly obligacionId: number;
  readonly condonado: Dinero;
  readonly prestamoCerrado: boolean;
};

export async function condonar(
  db: EjecutorSQL,
  params: {
    obligacionId: number;
    motivo: string;
    fecha: Dia;
    autor?: string;
    ahora: Instante;
  },
): Promise<ResultadoCondonacion> {
  const obligacion = await obtenerObligacion(db, params.obligacionId);
  if (!obligacion) {
    throw new ObligacionInexistenteError(`No existe la obligación ${params.obligacionId}.`);
  }

  if (obligacion.estado === 'condonada') {
    throw new NoSePuedeCondonarError('Esa deuda ya está condonada.');
  }
  if (obligacion.estado === 'pagada' || obligacion.estado === 'anulada') {
    throw new NoSePuedeCondonarError(
      `No se puede condonar una obligación en estado "${obligacion.estado}".`,
    );
  }
  if (obligacion.tipo === 'capital' || obligacion.tipo === 'cuota') {
    throw new NoSePuedeCondonarError(
      'Esto incluye capital, y perdonar capital es dar la plata por perdida. Si es eso lo ' +
        'que querés, cerrá el préstamo como incobrable.',
    );
  }

  const condonado = saldoObligacion(obligacion);
  if (!esPositivo(condonado)) {
    throw new NoSePuedeCondonarError('No queda nada por cobrar en esa obligación.');
  }

  await condonarObligacion(db, obligacion.id, params.ahora);

  const prestamo = await exigirPrestamo(db, obligacion.prestamoId);
  await registrarMovimiento(
    db,
    {
      tipo: 'condonacion',
      fecha: params.fecha,
      clienteId: prestamo.clienteId,
      prestamoId: prestamo.id,
      obligacionId: obligacion.id,
      moneda: obligacion.moneda,
      // Negativos: la condonación deshace una deuda que se había devengado.
      interes: negar(saldoDe(obligacion, 'interes')),
      mora: negar(saldoDe(obligacion, 'mora')),
      detalle: `Condonado: ${params.motivo.trim() || 'sin motivo'}`,
      autor: params.autor,
    },
    params.ahora,
  );

  // Si no queda nada más por cobrar, el préstamo se cierra: quedó saldado, aunque la última
  // parte se haya perdonado en vez de cobrado.
  const pendientes = await obligacionesCobrablesDePrestamo(db, prestamo.id);
  const prestamoCerrado = pendientes.length === 0 && prestamo.estado === 'activo';
  if (prestamoCerrado) {
    await cambiarEstadoPrestamo(
      db,
      prestamo.id,
      'pagado',
      'Saldado, con una parte condonada',
      params.ahora,
    );
  }

  return { obligacionId: obligacion.id, condonado, prestamoCerrado };
}
