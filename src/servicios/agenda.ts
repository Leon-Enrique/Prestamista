/**
 * Agenda de cobros: qué hay que cobrarle a quién hasta cierta fecha.
 *
 * Solo lee. Junta dos cosas:
 *
 * - Lo que ya existe como obligación y vence hasta esa fecha (incluido lo atrasado).
 * - En solo interés, el interés de los períodos que **todavía no vencieron**: el devengo no
 *   genera interés hacia adelante, así que sin esta proyección un cobro de solo interés no
 *   aparecería en la agenda hasta el mismo día del vencimiento. Se calcula igual que lo
 *   calculará el devengo: sobre el saldo de capital de hoy.
 */

import { interesDelPeriodo } from '../dominio/interes';
import { saldoDe, saldoObligacion } from '../dominio/obligaciones';
import { familiaDe, type Obligacion } from '../dominio/tipos';
import { cero, esPositivo, sumar, type Dinero } from '../nucleo/dinero';
import { comparar, vencimientoDePeriodo, type Dia } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { listarClientes } from '../datos/repositorios/clientes';
import { obligacionesDePrestamo } from '../datos/repositorios/obligaciones';
import { prestamosActivos } from '../datos/repositorios/prestamos';

export type CobroAgendado = {
  readonly prestamoId: number;
  readonly clienteId: number;
  readonly clienteNombre: string;
  /** El vencimiento más viejo de lo que hay que cobrar. */
  readonly fecha: Dia;
  /** Todo lo que vence hasta la fecha pedida, lo atrasado incluido. */
  readonly monto: Dinero;
  readonly atrasado: boolean;
};

const esCobrable = (o: Obligacion) => o.estado === 'pendiente' || o.estado === 'parcial';

export async function agendaDeCobros(
  db: EjecutorSQL,
  params: { hoy: Dia; hasta: Dia },
): Promise<CobroAgendado[]> {
  const { hoy, hasta } = params;
  const clientes = new Map(
    (await listarClientes(db, { incluirInactivos: true })).map((c) => [c.id, c.nombre]),
  );

  const agenda: CobroAgendado[] = [];

  for (const prestamo of await prestamosActivos(db)) {
    const { condiciones } = prestamo;
    const moneda = condiciones.capital.moneda;
    const obligaciones = await obligacionesDePrestamo(db, prestamo.id);
    const partes: { fecha: Dia; monto: Dinero }[] = [];

    for (const o of obligaciones) {
      if (!esCobrable(o) || o.vencimiento === null) continue;
      if (comparar(o.vencimiento, hasta) > 0) continue;
      partes.push({ fecha: o.vencimiento, monto: saldoObligacion(o) });
    }

    if (familiaDe(condiciones.modalidad) === 'devengo_abierto') {
      const saldoCapital = sumar(
        cero(moneda),
        ...obligaciones.filter(esCobrable).map((o) => saldoDe(o, 'capital')),
      );
      if (esPositivo(saldoCapital)) {
        const interes = interesDelPeriodo(saldoCapital, condiciones.tasa, condiciones.frecuencia);
        const yaDevengados = new Set(
          obligaciones.filter((o) => o.tipo === 'interes').map((o) => o.vencimiento),
        );
        for (let numero = 1; ; numero += 1) {
          const vencimiento = vencimientoDePeriodo(
            condiciones.fechaDesembolso,
            condiciones.frecuencia,
            numero,
          );
          if (comparar(vencimiento, hasta) > 0) break;
          // Lo que ya venció lo generó el devengo y está arriba como obligación.
          if (comparar(vencimiento, hoy) <= 0 || yaDevengados.has(vencimiento)) continue;
          partes.push({ fecha: vencimiento, monto: interes });
        }
      }
    }

    const conMonto = partes.filter((p) => esPositivo(p.monto));
    if (conMonto.length === 0) continue;

    const fecha = conMonto.map((p) => p.fecha).sort(comparar)[0];
    agenda.push({
      prestamoId: prestamo.id,
      clienteId: prestamo.clienteId,
      clienteNombre: clientes.get(prestamo.clienteId) ?? 'Cliente',
      fecha,
      monto: sumar(...conMonto.map((p) => p.monto)),
      atrasado: comparar(fecha, hoy) < 0,
    });
  }

  return agenda.sort((a, b) => comparar(a.fecha, b.fecha));
}
