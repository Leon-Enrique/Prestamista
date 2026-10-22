/**
 * Anular un préstamo que se registró pero no se concretó: el cliente se arrepintió y
 * devolvió la plata en el momento.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`).
 *
 * No es un cobro (la app creería que volvió capital) ni una pérdida (creería que se perdió
 * plata): es "este préstamo no existió". Nada se borra:
 *
 * - el préstamo pasa a `anulado` y sus obligaciones abiertas a `anulada`;
 * - el libro recibe un asiento de reverso del desembolso;
 * - si la plata había salido de la caja, vuelve a entrar.
 *
 * Solo se permite sin cobros vigentes: si ya se cobró algo, primero se anulan esos cobros.
 */

import { dinero, negar, type Dinero } from '../nucleo/dinero';
import { ErrorDeNegocio, PrestamoNoActivoError } from '../nucleo/errores';
import type { Dia, Instante } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import {
  cambiarEstadoObligacion,
  obligacionesDePrestamo,
} from '../datos/repositorios/obligaciones';
import { pagosDePrestamo } from '../datos/repositorios/pagos';
import { cambiarEstadoPrestamo, exigirPrestamo } from '../datos/repositorios/prestamos';
import { registrarMovimiento, registrarMovimientoDeCaja } from './libro';

export class PrestamoConCobrosError extends ErrorDeNegocio {}

export async function anularPrestamo(
  db: EjecutorSQL,
  params: { prestamoId: number; motivo: string; fecha: Dia; autor?: string; ahora: Instante },
): Promise<{ readonly devueltoACaja: Dinero | null }> {
  const prestamo = await exigirPrestamo(db, params.prestamoId);
  if (prestamo.estado !== 'activo') {
    throw new PrestamoNoActivoError(`El préstamo ${prestamo.id} está "${prestamo.estado}".`);
  }

  const cobros = (await pagosDePrestamo(db, prestamo.id)).filter((p) => p.revertidoEn === null);
  if (cobros.length > 0) {
    throw new PrestamoConCobrosError(
      'Este préstamo tiene cobros. Anulá esos cobros primero y después el préstamo.',
    );
  }

  const motivo = params.motivo.trim() || 'Sin motivo';
  const moneda = prestamo.condiciones.capital.moneda;

  for (const o of await obligacionesDePrestamo(db, prestamo.id)) {
    if (o.estado === 'pendiente' || o.estado === 'parcial') {
      await cambiarEstadoObligacion(db, o.id, 'anulada', params.ahora);
    }
  }

  const desembolso = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM movimientos WHERE tipo = 'desembolso' AND prestamo_id = ? ORDER BY id LIMIT 1",
    prestamo.id,
  );
  await registrarMovimiento(
    db,
    {
      tipo: 'reverso',
      fecha: params.fecha,
      clienteId: prestamo.clienteId,
      prestamoId: prestamo.id,
      moneda,
      capital: negar(prestamo.condiciones.capital),
      movimientoRevertidoId: desembolso?.id ?? null,
      detalle: `Préstamo anulado: ${motivo}`,
      autor: params.autor,
    },
    params.ahora,
  );

  // Si la entrega salió de la caja, la devolución vuelve a entrar por el mismo monto.
  const salida = await db.getFirstAsync<{ monto_centavos: number }>(
    "SELECT monto_centavos FROM caja_movimientos WHERE tipo = 'desembolso' AND prestamo_id = ? AND monto_centavos < 0 ORDER BY id LIMIT 1",
    prestamo.id,
  );
  let devueltoACaja: Dinero | null = null;
  if (salida) {
    devueltoACaja = dinero(-salida.monto_centavos, moneda);
    await registrarMovimientoDeCaja(
      db,
      {
        tipo: 'desembolso',
        fecha: params.fecha,
        monto: devueltoACaja,
        prestamoId: prestamo.id,
        detalle: `Préstamo anulado: ${motivo}`,
      },
      params.ahora,
    );
  }

  await cambiarEstadoPrestamo(db, prestamo.id, 'anulado', motivo, params.ahora);
  return { devueltoACaja };
}
