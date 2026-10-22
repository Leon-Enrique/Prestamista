/**
 * Eliminar un cliente de la lista.
 *
 * No se borra: se desactiva. Lo que pagó sigue contando en los reportes y en lo ganado, y
 * su historial se puede ver igual — borrarlo cambiaría números de meses ya cerrados.
 *
 * Solo se permite si no debe nada en un préstamo activo: si no, la deuda desaparecería de la
 * cartera sin que nadie la haya cobrado ni dado por perdida.
 */

import { deudaPorCliente } from '../datos/consultas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { desactivarCliente, exigirCliente } from '../datos/repositorios/clientes';
import { formatear } from '../nucleo/dinero';
import { ErrorDeNegocio } from '../nucleo/errores';
import type { Dia, Instante } from '../nucleo/fechas';

export class ClienteConDeudaError extends ErrorDeNegocio {}

export async function eliminarCliente(
  db: EjecutorSQL,
  params: { clienteId: number; hoy: Dia; ahora: Instante },
): Promise<void> {
  await exigirCliente(db, params.clienteId);

  const deuda = (await deudaPorCliente(db, params.hoy)).get(params.clienteId);
  if (deuda) {
    throw new ClienteConDeudaError(
      `Todavía debe ${deuda.saldos.map((s) => formatear(s)).join(' y ')}. ` +
        'Cobrale o dalo por perdido antes de eliminarlo.',
    );
  }

  await desactivarCliente(db, params.clienteId, params.ahora);
}
