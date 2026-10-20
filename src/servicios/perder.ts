/**
 * Dar un préstamo por perdido, y reactivarlo si el cliente vuelve a pagar.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`).
 *
 * Perder no es condonar: condonar es perdonar un interés o una penalización a alguien que
 * sigue pagando; perder es aceptar que **el capital no vuelve**. El préstamo pasa a
 * `incobrable`, sale de la cartera y deja de generar interés (el devengo solo mira préstamos
 * activos).
 *
 * Las obligaciones **no se tocan**: la deuda sigue existiendo, y si el cliente aparece y
 * paga, se reactiva el préstamo y se cobra como cualquier otro. Por eso la pérdida no se
 * guarda como un número aparte: es el capital pendiente de los préstamos incobrables, y
 * desaparece sola al reactivar.
 */

import { saldoDe } from '../dominio/obligaciones';
import { cero, negar, sumar, type Dinero } from '../nucleo/dinero';
import { ErrorDeNegocio, PrestamoNoActivoError, SinDeudaError } from '../nucleo/errores';
import type { Dia, Instante } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { obligacionesCobrablesDePrestamo } from '../datos/repositorios/obligaciones';
import { cambiarEstadoPrestamo, exigirPrestamo } from '../datos/repositorios/prestamos';
import { registrarMovimiento } from './libro';

export class NoEstaPerdidoError extends ErrorDeNegocio {}

async function capitalPendiente(db: EjecutorSQL, prestamoId: number, moneda: Dinero['moneda']) {
  const cobrables = await obligacionesCobrablesDePrestamo(db, prestamoId);
  return {
    hayDeuda: cobrables.length > 0,
    capital: sumar(cero(moneda), ...cobrables.map((o) => saldoDe(o, 'capital'))),
  };
}

export async function darPorPerdido(
  db: EjecutorSQL,
  params: { prestamoId: number; motivo: string; fecha: Dia; autor?: string; ahora: Instante },
): Promise<{ readonly perdido: Dinero }> {
  const prestamo = await exigirPrestamo(db, params.prestamoId);
  if (prestamo.estado !== 'activo') {
    throw new PrestamoNoActivoError(`El préstamo ${prestamo.id} está "${prestamo.estado}".`);
  }

  const moneda = prestamo.condiciones.capital.moneda;
  const { hayDeuda, capital } = await capitalPendiente(db, prestamo.id, moneda);
  if (!hayDeuda) {
    throw new SinDeudaError('Este préstamo no debe nada.');
  }

  const motivo = params.motivo.trim() || 'Sin motivo';
  await cambiarEstadoPrestamo(db, prestamo.id, 'incobrable', motivo, params.ahora);
  await registrarMovimiento(
    db,
    {
      tipo: 'ajuste',
      fecha: params.fecha,
      clienteId: prestamo.clienteId,
      prestamoId: prestamo.id,
      capital: negar(capital),
      detalle: `Dado por perdido: ${motivo}`,
      autor: params.autor,
    },
    params.ahora,
  );

  return { perdido: capital };
}

export async function reactivarPrestamo(
  db: EjecutorSQL,
  params: { prestamoId: number; fecha: Dia; autor?: string; ahora: Instante },
): Promise<void> {
  const prestamo = await exigirPrestamo(db, params.prestamoId);
  if (prestamo.estado !== 'incobrable') {
    throw new NoEstaPerdidoError(`El préstamo ${prestamo.id} no está dado por perdido.`);
  }

  const moneda = prestamo.condiciones.capital.moneda;
  const { capital } = await capitalPendiente(db, prestamo.id, moneda);

  await cambiarEstadoPrestamo(db, prestamo.id, 'activo', null, params.ahora);
  await registrarMovimiento(
    db,
    {
      tipo: 'ajuste',
      fecha: params.fecha,
      clienteId: prestamo.clienteId,
      prestamoId: prestamo.id,
      capital,
      detalle: 'Reactivado: volvió a pagar',
      autor: params.autor,
    },
    params.ahora,
  );
}
