import {
  conPagoAplicado,
  conPagoQuitado,
  estadoSegunSaldo,
  pagadoDe,
} from '../../dominio/obligaciones';
import type { Componente, Obligacion, TipoObligacion } from '../../dominio/tipos';
import { cero, sumar, type Dinero, type Moneda } from '../../nucleo/dinero';
import { ObligacionInexistenteError } from '../../nucleo/errores';
import type { Dia, Instante } from '../../nucleo/fechas';
import type { EjecutorSQL } from '../ejecutor';
import { COLUMNAS_OBLIGACION, type FilaObligacion, obligacionDesdeFila } from '../mapeo';

export type DatosObligacion = {
  readonly prestamoId: number;
  readonly tipo: TipoObligacion;
  readonly numero?: number | null;
  readonly vencimiento: Dia | null;
  readonly moneda: Moneda;
  readonly capital?: Dinero;
  readonly interes?: Dinero;
  readonly mora?: Dinero;
  /**
   * Clave de idempotencia del devengo: `'2026-11'` para el interés de ese mes, `'mora:42'`
   * para la mora que crece sobre la obligación 42, `'capital'` para la única obligación de
   * capital. `null` en las cuotas de un cronograma cerrado, que se generan una sola vez.
   *
   * Hay un índice único sobre `(prestamo_id, tipo, periodo)`: es lo que hace **imposible**
   * duplicar la deuda de alguien cuando el devengo corre dos veces.
   */
  readonly periodo?: string | null;
  readonly obligacionOrigenId?: number | null;
};

export async function crearObligacion(
  db: EjecutorSQL,
  datos: DatosObligacion,
  ahora: Instante,
): Promise<number> {
  const nada = cero(datos.moneda);
  const resultado = await db.runAsync(
    `INSERT INTO obligaciones (
       prestamo_id, tipo, numero, vencimiento, moneda,
       capital_centavos, interes_centavos, mora_centavos,
       periodo, obligacion_origen_id, creado_en, actualizado_en
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    datos.prestamoId,
    datos.tipo,
    datos.numero ?? null,
    datos.vencimiento,
    datos.moneda,
    (datos.capital ?? nada).centavos,
    (datos.interes ?? nada).centavos,
    (datos.mora ?? nada).centavos,
    datos.periodo ?? null,
    datos.obligacionOrigenId ?? null,
    ahora,
    ahora,
  );
  return resultado.lastInsertRowId;
}

export async function obtenerObligacion(
  db: EjecutorSQL,
  id: number,
): Promise<Obligacion | null> {
  const fila = await db.getFirstAsync<FilaObligacion>(
    `SELECT ${COLUMNAS_OBLIGACION} FROM obligaciones WHERE id = ?`,
    id,
  );
  return fila ? obligacionDesdeFila(fila) : null;
}

export async function obligacionesDePrestamo(
  db: EjecutorSQL,
  prestamoId: number,
): Promise<Obligacion[]> {
  const filas = await db.getAllAsync<FilaObligacion>(
    `SELECT ${COLUMNAS_OBLIGACION} FROM obligaciones
      WHERE prestamo_id = ?
      ORDER BY vencimiento IS NULL, vencimiento, numero, id`,
    prestamoId,
  );
  return filas.map(obligacionDesdeFila);
}

/** Las que admiten un pago: pendientes o parciales. */
export async function obligacionesCobrablesDePrestamo(
  db: EjecutorSQL,
  prestamoId: number,
): Promise<Obligacion[]> {
  const filas = await db.getAllAsync<FilaObligacion>(
    `SELECT ${COLUMNAS_OBLIGACION} FROM obligaciones
      WHERE prestamo_id = ? AND estado IN ('pendiente', 'parcial')
      ORDER BY vencimiento IS NULL, vencimiento, numero, id`,
    prestamoId,
  );
  return filas.map(obligacionDesdeFila);
}

/**
 * Busca una obligación por su clave de devengo. Es la consulta que hace el devengo
 * idempotente: si ya existe la del período, no se crea otra.
 */
export async function obligacionPorPeriodo(
  db: EjecutorSQL,
  prestamoId: number,
  tipo: TipoObligacion,
  periodo: string,
): Promise<Obligacion | null> {
  const fila = await db.getFirstAsync<FilaObligacion>(
    `SELECT ${COLUMNAS_OBLIGACION} FROM obligaciones
      WHERE prestamo_id = ? AND tipo = ? AND periodo = ?`,
    prestamoId,
    tipo,
    periodo,
  );
  return fila ? obligacionDesdeFila(fila) : null;
}

/** Vencidas y sin pagar al día `hasta`, para que el devengo les calcule la mora. */
export async function obligacionesVencidasImpagas(
  db: EjecutorSQL,
  prestamoId: number,
  hasta: Dia,
): Promise<Obligacion[]> {
  const filas = await db.getAllAsync<FilaObligacion>(
    `SELECT ${COLUMNAS_OBLIGACION} FROM obligaciones
      WHERE prestamo_id = ?
        AND estado IN ('pendiente', 'parcial')
        AND tipo <> 'mora'
        AND vencimiento IS NOT NULL
        AND vencimiento < ?
      ORDER BY vencimiento, numero, id`,
    prestamoId,
    hasta,
  );
  return filas.map(obligacionDesdeFila);
}

const COLUMNA_PAGADA: Record<Componente, string> = {
  mora: 'pagado_mora_centavos',
  interes: 'pagado_interes_centavos',
  capital: 'pagado_capital_centavos',
};

/**
 * Suma un pago a un componente y recalcula el estado.
 *
 * El estado lo decide `conPagoAplicado()` del dominio, no un `CASE` en SQL: duplicar esa
 * regla en dos lenguajes es cómo un día dan distinto. La base igual tiene su `CHECK` de
 * "no se puede cobrar más de lo que se debe" como última red.
 */
export async function aplicarImputacion(
  db: EjecutorSQL,
  obligacionId: number,
  componente: Componente,
  monto: Dinero,
  ahora: Instante,
): Promise<Obligacion> {
  const actual = await obtenerObligacion(db, obligacionId);
  if (!actual) {
    throw new ObligacionInexistenteError(`No existe la obligación ${obligacionId}.`);
  }

  const actualizada = conPagoAplicado(actual, componente, monto);
  await db.runAsync(
    `UPDATE obligaciones
        SET ${COLUMNA_PAGADA[componente]} = ?, estado = ?, actualizado_en = ?
      WHERE id = ?`,
    pagadoDe(actualizada, componente).centavos,
    actualizada.estado,
    ahora,
    obligacionId,
  );
  return actualizada;
}

/**
 * Deshace una imputación: es lo que permite anular un pago.
 *
 * La fila de `imputaciones` **no se borra**. Lo que deja de contar es el pago entero, porque
 * queda marcado como revertido; esto solo corrige el saldo cacheado de la obligación. La
 * invariante que el libro mantiene —y que `datos/verificacion.ts` comprueba— es que lo pagado
 * de una obligación es la suma de las imputaciones de los pagos **no revertidos**.
 */
export async function quitarImputacion(
  db: EjecutorSQL,
  obligacionId: number,
  componente: Componente,
  monto: Dinero,
  ahora: Instante,
): Promise<Obligacion> {
  const actual = await obtenerObligacion(db, obligacionId);
  if (!actual) {
    throw new ObligacionInexistenteError(`No existe la obligación ${obligacionId}.`);
  }

  const actualizada = conPagoQuitado(actual, componente, monto);
  await db.runAsync(
    `UPDATE obligaciones
        SET ${COLUMNA_PAGADA[componente]} = ?, estado = ?, actualizado_en = ?
      WHERE id = ?`,
    pagadoDe(actualizada, componente).centavos,
    actualizada.estado,
    ahora,
    obligacionId,
  );
  return actualizada;
}

/**
 * Cambia los montos o el vencimiento de una obligación, y recalcula su estado.
 *
 * Es lo que permite representar una cuota negociada. El estado lo decide el dominio: si el
 * monto nuevo es igual a lo ya cobrado, la obligación queda pagada.
 */
export async function ajustarObligacion(
  db: EjecutorSQL,
  obligacionId: number,
  cambios: { capital?: Dinero; interes?: Dinero; vencimiento?: Dia | null },
  ahora: Instante,
): Promise<Obligacion> {
  const actual = await obtenerObligacion(db, obligacionId);
  if (!actual) {
    throw new ObligacionInexistenteError(`No existe la obligación ${obligacionId}.`);
  }

  const conCambios: Obligacion = {
    ...actual,
    capital: cambios.capital ?? actual.capital,
    interes: cambios.interes ?? actual.interes,
    vencimiento: cambios.vencimiento === undefined ? actual.vencimiento : cambios.vencimiento,
  };
  const actualizada: Obligacion = { ...conCambios, estado: estadoSegunSaldo(conCambios) };

  await db.runAsync(
    `UPDATE obligaciones
        SET capital_centavos = ?, interes_centavos = ?, vencimiento = ?, estado = ?,
            actualizado_en = ?
      WHERE id = ?`,
    actualizada.capital.centavos,
    actualizada.interes.centavos,
    actualizada.vencimiento,
    actualizada.estado,
    ahora,
    obligacionId,
  );
  return actualizada;
}

/**
 * Cambia el estado de una obligación a uno que es una **decisión**: condonada, anulada o
 * refinanciada. No se usa para los estados que se derivan del saldo —pendiente, parcial,
 * pagada—, que los calcula el dominio.
 */
export async function cambiarEstadoObligacion(
  db: EjecutorSQL,
  obligacionId: number,
  estado: 'condonada' | 'anulada' | 'refinanciada',
  ahora: Instante,
): Promise<void> {
  await db.runAsync(
    'UPDATE obligaciones SET estado = ?, actualizado_en = ? WHERE id = ?',
    estado,
    ahora,
    obligacionId,
  );
}

/**
 * Marca una obligación como condonada.
 *
 * **No la borra**: perdonar mora es parte del oficio, y hay que poder ver cuánto se perdonó
 * y a quién. Una obligación condonada deja de ser cobrable pero sigue en el historial.
 */
export async function condonarObligacion(
  db: EjecutorSQL,
  obligacionId: number,
  ahora: Instante,
): Promise<void> {
  await db.runAsync(
    "UPDATE obligaciones SET estado = 'condonada', actualizado_en = ? WHERE id = ?",
    ahora,
    obligacionId,
  );
}

/**
 * Hace crecer la mora ya devengada de una obligación.
 *
 * La mora de un atraso es **una sola obligación que crece**, no una por día: así condonarla
 * es una operación y no cincuenta, y el tope se aplica sobre un único monto.
 */
export async function sumarMoraDevengada(
  db: EjecutorSQL,
  obligacionId: number,
  monto: Dinero,
  ahora: Instante,
): Promise<void> {
  const actual = await obtenerObligacion(db, obligacionId);
  if (!actual) {
    throw new ObligacionInexistenteError(`No existe la obligación ${obligacionId}.`);
  }
  await db.runAsync(
    'UPDATE obligaciones SET mora_centavos = ?, actualizado_en = ? WHERE id = ?',
    sumar(actual.mora, monto).centavos,
    ahora,
    obligacionId,
  );
}
