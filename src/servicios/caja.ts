/**
 * Caja: la plata que tenés en la mano.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`).
 *
 * Los cobros y los desembolsos ya entran y salen solos. Lo que falta anotar es todo lo demás
 * que mueve el efectivo y no es un préstamo: lo que sacás para vos, lo que ponés de tu
 * bolsillo, un gasto. Sin eso la caja queda mal para siempre y el arqueo nunca cuadra — y
 * entonces deja de servir para detectar un error de verdad.
 *
 * El monto se guarda **con signo**: positivo entra, negativo sale. La función recibe siempre
 * un monto positivo y le pone el signo según el tipo, así quien llama no puede equivocarse.
 */

import {
  cero,
  esPositivo,
  formatear,
  negar,
  restar,
  type Dinero,
  type Moneda,
} from '../nucleo/dinero';
import { ErrorDeNegocio } from '../nucleo/errores';
import type { Dia, Instante } from '../nucleo/fechas';
import { saldoDeCaja } from '../datos/consultas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { registrarMovimientoDeCaja, type TipoMovimientoCaja } from './libro';

export class MovimientoDeCajaInvalidoError extends ErrorDeNegocio {}

/** Los tipos que el usuario anota a mano. Cobro y desembolso los genera el sistema. */
export type TipoManual = 'retiro' | 'aporte' | 'gasto';

export const TIPOS_MANUALES: readonly TipoManual[] = ['retiro', 'aporte', 'gasto'];

export const ETIQUETA_TIPO_MANUAL: Record<TipoManual, string> = {
  retiro: 'Saqué plata para mí',
  aporte: 'Puse plata de mi bolsillo',
  gasto: 'Gasto',
};

/** `aporte` suma al efectivo; `retiro` y `gasto` lo bajan. */
const ENTRA: Record<TipoManual, boolean> = { retiro: false, aporte: true, gasto: false };

export async function registrarManual(
  db: EjecutorSQL,
  params: {
    tipo: TipoManual;
    monto: Dinero;
    fecha: Dia;
    detalle: string;
    ahora: Instante;
  },
): Promise<number> {
  if (!esPositivo(params.monto)) {
    throw new MovimientoDeCajaInvalidoError(
      'El monto debe ser mayor a cero. El sentido lo decide el tipo de movimiento.',
    );
  }

  return registrarMovimientoDeCaja(
    db,
    {
      tipo: params.tipo as TipoMovimientoCaja,
      fecha: params.fecha,
      monto: ENTRA[params.tipo] ? params.monto : negar(params.monto),
      detalle: params.detalle.trim() || ETIQUETA_TIPO_MANUAL[params.tipo],
    },
    params.ahora,
  );
}

export type ResultadoArqueo = {
  readonly moneda: Moneda;
  /** Lo que el sistema dice que deberías tener. */
  readonly esperado: Dinero;
  /** Lo que contaste. */
  readonly contado: Dinero;
  /** Contado menos esperado. Positivo: sobra plata. Negativo: falta. */
  readonly diferencia: Dinero;
  readonly cuadro: boolean;
};

/**
 * Arqueo: contar el efectivo y comparar contra lo que dice el sistema.
 *
 * Si hay diferencia **no se corrige editando movimientos**: se registra un ajuste con su
 * monto y su motivo. Editar el pasado para que cuadre destruye lo único que hace útil al
 * arqueo, que es poder ver que hubo una diferencia y cuándo.
 *
 * Un arqueo que cuadra también se registra, con monto cero: saber qué días contaste y te
 * cerró es información, no ruido.
 */
export async function arquear(
  db: EjecutorSQL,
  params: {
    moneda: Moneda;
    contado: Dinero;
    fecha: Dia;
    detalle?: string;
    ahora: Instante;
  },
): Promise<ResultadoArqueo> {
  if (params.contado.moneda !== params.moneda) {
    throw new MovimientoDeCajaInvalidoError('Lo contado tiene que ser de la misma moneda.');
  }
  if (params.contado.centavos < 0) {
    throw new MovimientoDeCajaInvalidoError('No se puede contar efectivo negativo.');
  }

  const esperado = await efectivoEsperado(db, params.moneda);
  const diferencia = restar(params.contado, esperado);
  const cuadro = diferencia.centavos === 0;

  const nota = params.detalle?.trim();
  const explicacion = cuadro
    ? 'Arqueo: cuadró'
    : diferencia.centavos > 0
      ? `Arqueo: sobraban ${formatear(diferencia)}`
      : `Arqueo: faltaban ${formatear(negar(diferencia))}`;

  await registrarMovimientoDeCaja(
    db,
    {
      tipo: 'ajuste',
      fecha: params.fecha,
      monto: diferencia,
      detalle: nota ? `${explicacion}. ${nota}` : explicacion,
    },
    params.ahora,
  );

  return { moneda: params.moneda, esperado, contado: params.contado, diferencia, cuadro };
}

/** Lo que el sistema dice que tenés en efectivo de una moneda. */
export async function efectivoEsperado(db: EjecutorSQL, moneda: Moneda): Promise<Dinero> {
  const saldos = await saldoDeCaja(db);
  return saldos.find((saldo) => saldo.moneda === moneda) ?? cero(moneda);
}
