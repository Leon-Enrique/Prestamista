/**
 * Refinanciar un préstamo.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`).
 *
 * **Refinanciar no es editar el préstamo viejo.** Se cierra el viejo con su deuda trasladada
 * y se abre uno nuevo que lo referencia: dos operaciones enlazadas, nunca un registro
 * modificado. Si se editara el viejo se perdería para siempre cuánto se había pagado del
 * original y cuántas veces un cliente refinanció — que es justamente la señal de que ese
 * capital no está volviendo.
 *
 * Es también el **único lugar** donde el interés puede pasar a ser capital, y solo porque es
 * explícito y acordado: el saldo que se traslada entra como capital del préstamo nuevo. El
 * devengo automático nunca capitaliza (ver `devengar.ts`).
 *
 * Cubre los dos casos reales del rubro con la misma operación:
 *
 * - **Renovar**: no paga, se le da más plazo. El capital nuevo es el saldo viejo.
 * - **Prestarle más**: el capital nuevo es el saldo viejo más la plata que se entrega hoy.
 *   Solo esa plata nueva sale de la caja; el saldo trasladado nunca estuvo en el bolsillo.
 */

import { cero, esPositivo, negar, sumar, type Dinero } from '../nucleo/dinero';
import { ErrorDeNegocio, MonedaIncompatibleError } from '../nucleo/errores';
import type { Dia, Instante } from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import {
  cambiarEstadoObligacion,
  obligacionesCobrablesDePrestamo,
} from '../datos/repositorios/obligaciones';
import { cambiarEstadoPrestamo, exigirPrestamo } from '../datos/repositorios/prestamos';
import { saldoObligacion } from '../dominio/obligaciones';
import type { Condiciones, ReglasMora } from '../dominio/tipos';
import { desembolsar } from './desembolsar';
import { registrarMovimiento, registrarMovimientoDeCaja } from './libro';

export class NoSePuedeRefinanciarError extends ErrorDeNegocio {}

export type ParametrosRefinanciacion = {
  readonly prestamoId: number;
  /** Condiciones del préstamo nuevo. Su capital normalmente es el saldo viejo + plata nueva. */
  readonly condiciones: Condiciones;
  /** Plata que se entrega hoy en mano. Solo esto sale de la caja. */
  readonly efectivoEntregado?: Dinero;
  readonly motivo: string;
  readonly reglasMora?: ReglasMora | null;
  readonly notas?: string | null;
  readonly autor?: string;
  readonly fecha: Dia;
  readonly ahora: Instante;
};

export type ResultadoRefinanciacion = {
  readonly prestamoNuevoId: number;
  readonly saldoTrasladado: Dinero;
  readonly obligacionesTrasladadas: number;
  /**
   * Capital nuevo menos lo que lo justifica (saldo trasladado + plata entregada).
   *
   * Positivo: se le sumó algo acordado por encima de la deuda. Negativo: se le perdonó una
   * parte. Queda en el libro para que la cuenta se pueda reconstruir.
   */
  readonly diferenciaAcordada: Dinero;
};

export async function refinanciar(
  db: EjecutorSQL,
  params: ParametrosRefinanciacion,
): Promise<ResultadoRefinanciacion> {
  const viejo = await exigirPrestamo(db, params.prestamoId);
  if (viejo.estado !== 'activo') {
    throw new NoSePuedeRefinanciarError(
      `El préstamo ${viejo.id} está "${viejo.estado}" y no se puede refinanciar.`,
    );
  }

  const moneda = viejo.condiciones.capital.moneda;
  if (params.condiciones.capital.moneda !== moneda) {
    throw new MonedaIncompatibleError(
      `El préstamo está en ${moneda} y el nuevo en ${params.condiciones.capital.moneda}. ` +
        'Una refinanciación no cambia de moneda: el saldo que se traslada no se podría sumar.',
    );
  }

  const efectivoEntregado = params.efectivoEntregado ?? cero(moneda);
  if (efectivoEntregado.moneda !== moneda) {
    throw new MonedaIncompatibleError('La plata entregada tiene que ser de la misma moneda.');
  }

  const cobrables = await obligacionesCobrablesDePrestamo(db, viejo.id);
  const saldoTrasladado =
    cobrables.length === 0 ? cero(moneda) : sumar(...cobrables.map(saldoObligacion));

  if (!esPositivo(params.condiciones.capital)) {
    throw new NoSePuedeRefinanciarError('El capital del préstamo nuevo debe ser mayor a cero.');
  }

  // El préstamo nuevo se arma con `desembolsar` para no duplicar la generación de cuotas y
  // obligaciones. `saleDeCaja: false` porque acá solo sale la plata nueva, no el saldo que se
  // traslada: ese nunca estuvo en el bolsillo.
  const { prestamoId: prestamoNuevoId } = await desembolsar(db, {
    clienteId: viejo.clienteId,
    condiciones: params.condiciones,
    reglasMora: params.reglasMora ?? viejo.reglasMora,
    notas: params.notas ?? `Refinanciación del préstamo ${viejo.id}. ${params.motivo}`.trim(),
    prestamoOrigenId: viejo.id,
    saleDeCaja: false,
    autor: params.autor,
    ahora: params.ahora,
  });

  // La deuda vieja se muda: no está pagada ni perdonada.
  for (const obligacion of cobrables) {
    await cambiarEstadoObligacion(db, obligacion.id, 'refinanciada', params.ahora);
  }

  await cambiarEstadoPrestamo(
    db,
    viejo.id,
    'refinanciado',
    `Trasladado al préstamo ${prestamoNuevoId}. ${params.motivo}`.trim(),
    params.ahora,
  );

  // Un asiento por préstamo: sale del viejo, entra al nuevo. Así el libro de cada uno se
  // explica solo.
  await registrarMovimiento(
    db,
    {
      tipo: 'refinanciacion',
      fecha: params.fecha,
      clienteId: viejo.clienteId,
      prestamoId: viejo.id,
      moneda,
      capital: negar(saldoTrasladado),
      detalle: `Deuda trasladada al préstamo ${prestamoNuevoId}. ${params.motivo}`.trim(),
      autor: params.autor,
    },
    params.ahora,
  );

  await registrarMovimiento(
    db,
    {
      tipo: 'refinanciacion',
      fecha: params.fecha,
      clienteId: viejo.clienteId,
      prestamoId: prestamoNuevoId,
      moneda,
      capital: saldoTrasladado,
      detalle: `Viene del préstamo ${viejo.id}. ${params.motivo}`.trim(),
      autor: params.autor,
    },
    params.ahora,
  );

  if (esPositivo(efectivoEntregado)) {
    await registrarMovimientoDeCaja(
      db,
      {
        tipo: 'desembolso',
        fecha: params.fecha,
        monto: negar(efectivoEntregado),
        prestamoId: prestamoNuevoId,
        detalle: `Plata nueva en la refinanciación del préstamo ${viejo.id}`,
      },
      params.ahora,
    );
  }

  return {
    prestamoNuevoId,
    saldoTrasladado,
    obligacionesTrasladadas: cobrables.length,
    diferenciaAcordada: {
      centavos:
        params.condiciones.capital.centavos -
        saldoTrasladado.centavos -
        efectivoEntregado.centavos,
      moneda,
    },
  };
}
