/**
 * Desembolsar un préstamo.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`). Escribe el préstamo, sus
 * obligaciones, el asiento del libro y el movimiento de caja: si se cortara a mitad, la
 * cartera quedaría inconsistente, y en un celular la app se puede cerrar en cualquier
 * momento — batería, una llamada entrante, el sistema matándola en segundo plano.
 */

import { generarCronograma, resumenCronograma, type ResumenCronograma } from '../dominio/cronograma';
import { familiaDe, type Condiciones, type ReglasMora } from '../dominio/tipos';
import { negar } from '../nucleo/dinero';
import type { Instante } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { crearObligacion } from '../datos/repositorios/obligaciones';
import { crearPrestamo } from '../datos/repositorios/prestamos';
import { exigirCliente } from '../datos/repositorios/clientes';
import { registrarMovimiento, registrarMovimientoDeCaja } from './libro';

export type ParametrosDesembolso = {
  readonly clienteId: number;
  readonly condiciones: Condiciones;
  /** `null` o ausente = usa las reglas de mora de `config`. */
  readonly reglasMora?: ReglasMora | null;
  readonly notas?: string | null;
  /** Si este préstamo nace de refinanciar otro. */
  readonly prestamoOrigenId?: number | null;
  /** Si el efectivo no sale de la caja (por ejemplo, una transferencia). */
  readonly saleDeCaja?: boolean;
  readonly autor?: string;
  readonly ahora: Instante;
};

export type ResultadoDesembolso = {
  readonly prestamoId: number;
  readonly obligacionesCreadas: number;
  /** Solo en cronograma cerrado; en solo interés no hay cronograma que resumir. */
  readonly resumen: ResumenCronograma | null;
};

export async function desembolsar(
  db: EjecutorSQL,
  params: ParametrosDesembolso,
): Promise<ResultadoDesembolso> {
  const { condiciones, ahora } = params;
  const cliente = await exigirCliente(db, params.clienteId);
  const moneda = condiciones.capital.moneda;

  const prestamoId = await crearPrestamo(
    db,
    {
      clienteId: cliente.id,
      condiciones,
      reglasMora: params.reglasMora ?? null,
      notas: params.notas ?? null,
      prestamoOrigenId: params.prestamoOrigenId ?? null,
    },
    ahora,
  );

  let obligacionesCreadas = 0;
  let resumen: ResumenCronograma | null = null;

  if (familiaDe(condiciones.modalidad) === 'cronograma_cerrado') {
    // Cronograma cerrado: todas las cuotas se conocen al desembolsar y se guardan ahora.
    // Desde acá son datos editables con rastro, no una fórmula que se vuelva a evaluar.
    const lineas = generarCronograma(condiciones);
    resumen = resumenCronograma(lineas);

    for (const linea of lineas) {
      await crearObligacion(
        db,
        {
          prestamoId,
          tipo: 'cuota',
          numero: linea.numero,
          vencimiento: linea.vencimiento,
          moneda,
          capital: linea.capital,
          interes: linea.interes,
          // `periodo` nulo: las cuotas se generan una sola vez, no las devenga nadie.
          periodo: null,
        },
        ahora,
      );
      obligacionesCreadas += 1;
    }
  } else {
    // Devengo abierto: solo se crea la obligación de capital. El interés de cada período lo
    // genera `devengar()` sobre el saldo vigente, porque si abona capital a mitad de camino
    // el interés de los períodos siguientes cambia.
    await crearObligacion(
      db,
      {
        prestamoId,
        tipo: 'capital',
        vencimiento: condiciones.vencimientoCapital,
        moneda,
        capital: condiciones.capital,
        // Un préstamo tiene una sola obligación de capital; la clave lo garantiza.
        periodo: 'capital',
      },
      ahora,
    );
    obligacionesCreadas = 1;
  }

  await registrarMovimiento(
    db,
    {
      tipo: 'desembolso',
      fecha: condiciones.fechaDesembolso,
      clienteId: cliente.id,
      prestamoId,
      moneda,
      capital: condiciones.capital,
      detalle: `Desembolso a ${cliente.nombre}`,
      autor: params.autor,
    },
    ahora,
  );

  if (params.saleDeCaja !== false) {
    await registrarMovimientoDeCaja(
      db,
      {
        tipo: 'desembolso',
        fecha: condiciones.fechaDesembolso,
        // Sale de la caja: negativo.
        monto: negar(condiciones.capital),
        prestamoId,
        detalle: `Préstamo a ${cliente.nombre}`,
      },
      ahora,
    );
  }

  return { prestamoId, obligacionesCreadas, resumen };
}
