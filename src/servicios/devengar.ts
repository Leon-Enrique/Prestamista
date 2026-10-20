/**
 * Devengo: generar las obligaciones que el paso del tiempo produce.
 *
 * Corre **al abrir la app**, porque no hay servidor que lo haga por la noche. Dos cosas que
 * no son negociables:
 *
 * - **Idempotente.** Devengar dos veces el mismo período duplicaría la deuda de una persona
 *   real. La clave `(prestamo, tipo, periodo)` tiene índice único en la base, así que ni un
 *   error de código puede hacerlo.
 * - **Nunca hacia adelante.** No existe el interés de un mes que todavía no transcurrió. Lo
 *   que el cliente ve como "lo que debe si paga hoy" es un cálculo de pantalla, no una
 *   obligación guardada.
 *
 * **Correr dentro de `enTransaccion()`** (ver `datos/base.ts`).
 */

import { interesDelPeriodo } from '../dominio/interes';
import { moraPendienteDeDevengar } from '../dominio/mora';
import { saldoDe, saldoObligacion } from '../dominio/obligaciones';
import { familiaDe, type Obligacion, type Prestamo, type ReglasMora } from '../dominio/tipos';
import { cero, esPositivo, sumar, type Dinero } from '../nucleo/dinero';
import {
  comparar,
  diasEntre,
  DIAS_DE_FRECUENCIA,
  vencimientoDePeriodo,
  type Dia,
  type Instante,
} from '../nucleo/fechas';
import type { EjecutorSQL } from '../datos/ejecutor';
import { leerConfiguracion, reglasMoraDe } from '../datos/repositorios/config';
import {
  crearObligacion,
  obligacionesDePrestamo,
  obligacionesVencidasImpagas,
  obligacionPorPeriodo,
  sumarMoraDevengada,
} from '../datos/repositorios/obligaciones';
import { prestamosActivos } from '../datos/repositorios/prestamos';
import { registrarMovimiento } from './libro';

export type ResumenDevengo = {
  readonly prestamosRevisados: number;
  readonly interesesCreados: number;
  readonly morasCreadas: number;
  readonly morasAumentadas: number;
};

export async function devengar(
  db: EjecutorSQL,
  params: { hoy: Dia; ahora: Instante; autor?: string },
): Promise<ResumenDevengo> {
  const configuracion = await leerConfiguracion(db);
  const reglasGenerales = reglasMoraDe(configuracion);
  const prestamos = await prestamosActivos(db);

  let interesesCreados = 0;
  let morasCreadas = 0;
  let morasAumentadas = 0;

  for (const prestamo of prestamos) {
    interesesCreados += await devengarIntereses(db, prestamo, params);
    const mora = await devengarMora(db, prestamo, reglasGenerales, params);
    morasCreadas += mora.creadas;
    morasAumentadas += mora.aumentadas;
  }

  return {
    prestamosRevisados: prestamos.length,
    interesesCreados,
    morasCreadas,
    morasAumentadas,
  };
}

/** El saldo de capital que falta cobrar de un préstamo. */
function saldoDeCapital(obligaciones: Obligacion[], moneda: Dinero['moneda']): Dinero {
  const cobrables = obligaciones.filter(
    (o) => o.estado === 'pendiente' || o.estado === 'parcial',
  );
  if (cobrables.length === 0) return cero(moneda);
  return sumar(...cobrables.map((o) => saldoDe(o, 'capital')));
}

/**
 * Interés de los períodos ya transcurridos, solo para la familia de devengo abierto.
 *
 * El interés se calcula sobre el **saldo de capital actual**, incluso cuando hay varios
 * períodos atrasados. Suena aproximado pero es exacto en esta app: el capital solo puede
 * bajar registrando un pago acá, y si la app no se abrió, no se registró ningún pago — así
 * que el saldo de hoy es el que estuvo vigente todo ese tiempo.
 *
 * Lo que sí queda fuera de alcance a propósito: si se registra un pago con fecha hacia
 * atrás, el interés ya devengado **no se recalcula**. Es correcto — no se reescribe la
 * historia — y es la razón por la que la clave de idempotencia existe.
 */
async function devengarIntereses(
  db: EjecutorSQL,
  prestamo: Prestamo,
  params: { hoy: Dia; ahora: Instante; autor?: string },
): Promise<number> {
  const { condiciones } = prestamo;
  if (familiaDe(condiciones.modalidad) !== 'devengo_abierto') return 0;

  const moneda = condiciones.capital.moneda;
  const obligaciones = await obligacionesDePrestamo(db, prestamo.id);
  const saldoCapital = saldoDeCapital(obligaciones, moneda);

  // Capital devuelto: el interés deja de correr. Es la contracara de calcularlo sobre saldo.
  if (!esPositivo(saldoCapital)) return 0;

  const diasDelPeriodo = DIAS_DE_FRECUENCIA[condiciones.frecuencia];
  const diasTranscurridos = diasEntre(condiciones.fechaDesembolso, params.hoy);
  if (diasTranscurridos <= 0) return 0;

  // Cota segura: adentro igual se verifica que el vencimiento ya pasó, así que una vuelta
  // de más no hace nada. Los meses reales tienen entre 28 y 31 días y la base es 30.
  const periodosPosibles = Math.floor(diasTranscurridos / diasDelPeriodo) + 2;
  const interesDelPeriodoActual = interesDelPeriodo(
    saldoCapital,
    condiciones.tasa,
    condiciones.frecuencia,
  );
  if (!esPositivo(interesDelPeriodoActual)) return 0;

  let creados = 0;

  for (let numero = 1; numero <= periodosPosibles; numero += 1) {
    const vencimiento = vencimientoDePeriodo(
      condiciones.fechaDesembolso,
      condiciones.frecuencia,
      numero,
    );
    // Nunca hacia adelante: el período tiene que haber terminado.
    if (comparar(vencimiento, params.hoy) > 0) break;

    // La fecha del vencimiento es la clave de idempotencia: única por préstamo y legible.
    const periodo = vencimiento as string;
    const yaExiste = await obligacionPorPeriodo(db, prestamo.id, 'interes', periodo);
    if (yaExiste) continue;

    const obligacionId = await crearObligacion(
      db,
      {
        prestamoId: prestamo.id,
        tipo: 'interes',
        numero,
        vencimiento,
        moneda,
        interes: interesDelPeriodoActual,
        periodo,
      },
      params.ahora,
    );

    await registrarMovimiento(
      db,
      {
        tipo: 'devengo_interes',
        fecha: vencimiento,
        clienteId: prestamo.clienteId,
        prestamoId: prestamo.id,
        obligacionId,
        moneda,
        interes: interesDelPeriodoActual,
        detalle: `Interés del período ${numero}`,
        autor: params.autor,
      },
      params.ahora,
    );

    creados += 1;
  }

  return creados;
}

/**
 * Mora de lo vencido e impago.
 *
 * La mora es **una sola obligación por atraso, que crece**, no una por día: así condonarla
 * es una operación y no cincuenta, y el tope se aplica sobre un monto único.
 *
 * **Excepción deliberada**: al capital de un préstamo de solo interés no se le cobra mora
 * mientras siga devengando interés corriente. La penalidad por tener el capital afuera *es*
 * ese interés que sigue corriendo; sumarle mora encima sería cobrar dos veces lo mismo. En
 * los préstamos con cuotas no aplica, porque una cuota vencida deja de generar interés nuevo
 * y la mora es su única penalidad.
 */
async function devengarMora(
  db: EjecutorSQL,
  prestamo: Prestamo,
  reglasGenerales: ReglasMora,
  params: { hoy: Dia; ahora: Instante; autor?: string },
): Promise<{ creadas: number; aumentadas: number }> {
  const reglas = prestamo.reglasMora ?? reglasGenerales;
  const moneda = prestamo.condiciones.capital.moneda;
  const esDevengoAbierto = familiaDe(prestamo.condiciones.modalidad) === 'devengo_abierto';

  const vencidas = await obligacionesVencidasImpagas(db, prestamo.id, params.hoy);
  let creadas = 0;
  let aumentadas = 0;

  for (const obligacion of vencidas) {
    if (obligacion.vencimiento === null) continue;
    if (esDevengoAbierto && obligacion.tipo === 'capital') continue;

    const periodo = `mora:${obligacion.id}`;
    const existente = await obligacionPorPeriodo(db, prestamo.id, 'mora', periodo);

    const pendiente = moraPendienteDeDevengar({
      montoVencido: saldoObligacion(obligacion),
      vencimiento: obligacion.vencimiento,
      hasta: params.hoy,
      reglas,
      yaDevengada: existente?.mora ?? cero(moneda),
    });

    if (!esPositivo(pendiente)) continue;

    let obligacionMoraId: number;
    if (existente) {
      await sumarMoraDevengada(db, existente.id, pendiente, params.ahora);
      obligacionMoraId = existente.id;
      aumentadas += 1;
    } else {
      obligacionMoraId = await crearObligacion(
        db,
        {
          prestamoId: prestamo.id,
          tipo: 'mora',
          // Misma fecha que lo que penaliza: se cobra junto y ordena con ella.
          vencimiento: obligacion.vencimiento,
          moneda,
          mora: pendiente,
          periodo,
          obligacionOrigenId: obligacion.id,
        },
        params.ahora,
      );
      creadas += 1;
    }

    await registrarMovimiento(
      db,
      {
        tipo: 'devengo_mora',
        fecha: params.hoy,
        clienteId: prestamo.clienteId,
        prestamoId: prestamo.id,
        obligacionId: obligacionMoraId,
        moneda,
        mora: pendiente,
        detalle: `Mora de la obligación ${obligacion.id}`,
        autor: params.autor,
      },
      params.ahora,
    );
  }

  return { creadas, aumentadas };
}
