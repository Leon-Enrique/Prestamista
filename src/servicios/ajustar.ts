/**
 * Ajustar una obligación: la cuota negociada.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`).
 *
 * "Este mes pagame 200 menos y lo acomodamos", "te doy una semana más". En la vida real se
 * negocia, y el cronograma existe como **dato editable con rastro** justamente para poder
 * representarlo — si fuera una fórmula que se recalcula desde los parámetros del préstamo,
 * nada de esto se podría anotar.
 *
 * Todo ajuste deja su asiento con el motivo y con la diferencia, para que la cuenta se pueda
 * reconstruir. Lo que **no** hace es tocar lo ya cobrado: un monto nuevo nunca puede quedar
 * por debajo de lo que el cliente ya pagó de ese componente.
 *
 * Mover el vencimiento hacia adelante **no borra la mora ya devengada**, y es a propósito: la
 * mora de un atraso que ocurrió, ocurrió. Si la querés perdonar, eso es condonar.
 */

import { esNegativo, formatear, restar, sumar, type Dinero } from '../nucleo/dinero';
import { ErrorDeNegocio, ObligacionInexistenteError } from '../nucleo/errores';
import type { Dia, Instante } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { ajustarObligacion, obtenerObligacion } from '../datos/repositorios/obligaciones';
import { exigirPrestamo } from '../datos/repositorios/prestamos';
import { pagadoDe } from '../dominio/obligaciones';
import { registrarMovimiento } from './libro';

export class AjusteInvalidoError extends ErrorDeNegocio {}

export type ParametrosAjuste = {
  readonly obligacionId: number;
  readonly nuevoCapital?: Dinero;
  readonly nuevoInteres?: Dinero;
  /** `undefined` deja la fecha como está; `null` la quita. */
  readonly nuevoVencimiento?: Dia | null;
  readonly motivo: string;
  readonly fecha: Dia;
  readonly autor?: string;
  readonly ahora: Instante;
};

export type ResultadoAjuste = {
  readonly obligacionId: number;
  /** Lo que cambió el total de la obligación. Negativo: se le bajó la deuda. */
  readonly diferencia: Dinero;
};

export async function ajustar(
  db: EjecutorSQL,
  params: ParametrosAjuste,
): Promise<ResultadoAjuste> {
  const actual = await obtenerObligacion(db, params.obligacionId);
  if (!actual) {
    throw new ObligacionInexistenteError(`No existe la obligación ${params.obligacionId}.`);
  }

  if (actual.estado !== 'pendiente' && actual.estado !== 'parcial') {
    throw new AjusteInvalidoError(
      `No se puede ajustar una obligación en estado "${actual.estado}".`,
    );
  }
  if (params.motivo.trim().length === 0) {
    throw new AjusteInvalidoError('Un ajuste necesita un motivo: queda en el libro.');
  }

  // No se puede dejar un monto por debajo de lo ya cobrado: eso sería "desaparecer" plata que
  // el cliente entregó. Si hace falta, primero se anula el pago.
  const exigirNoMenorALoPagado = (nuevo: Dinero | undefined, componente: 'capital' | 'interes') => {
    if (nuevo === undefined) return;
    const yaPagado = pagadoDe(actual, componente);
    if (esNegativo(restar(nuevo, yaPagado))) {
      throw new AjusteInvalidoError(
        `Ya cobraste ${formatear(yaPagado)} de ${componente}, así que no podés dejarlo en ` +
          `${formatear(nuevo)}. Si el cobro estaba mal, anulalo primero.`,
      );
    }
    if (esNegativo(nuevo)) {
      throw new AjusteInvalidoError('Un monto no puede ser negativo.');
    }
  };

  exigirNoMenorALoPagado(params.nuevoCapital, 'capital');
  exigirNoMenorALoPagado(params.nuevoInteres, 'interes');

  const totalAntes = sumar(actual.capital, actual.interes);
  const actualizada = await ajustarObligacion(
    db,
    actual.id,
    {
      capital: params.nuevoCapital,
      interes: params.nuevoInteres,
      vencimiento: params.nuevoVencimiento,
    },
    params.ahora,
  );
  const totalDespues = sumar(actualizada.capital, actualizada.interes);
  const diferencia = restar(totalDespues, totalAntes);

  const prestamo = await exigirPrestamo(db, actual.prestamoId);
  const cambioDeFecha =
    params.nuevoVencimiento !== undefined && params.nuevoVencimiento !== actual.vencimiento;

  await registrarMovimiento(
    db,
    {
      tipo: 'ajuste',
      fecha: params.fecha,
      clienteId: prestamo.clienteId,
      prestamoId: prestamo.id,
      obligacionId: actual.id,
      moneda: actual.moneda,
      capital: restar(actualizada.capital, actual.capital),
      interes: restar(actualizada.interes, actual.interes),
      detalle:
        `Cuota ajustada: ${params.motivo.trim()}` +
        (cambioDeFecha
          ? ` (vencimiento ${actual.vencimiento ?? 'sin fecha'} → ${actualizada.vencimiento ?? 'sin fecha'})`
          : ''),
      autor: params.autor,
    },
    params.ahora,
  );

  return { obligacionId: actual.id, diferencia };
}
