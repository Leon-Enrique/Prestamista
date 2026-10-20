import type { Condiciones, EstadoPrestamo, Prestamo, ReglasMora } from '../../dominio/tipos';
import { PrestamoInexistenteError } from '../../nucleo/errores';
import type { Instante } from '../../nucleo/fechas';
import type { EjecutorSQL } from '../ejecutor';
import { COLUMNAS_PRESTAMO, type FilaPrestamo, prestamoDesdeFila } from '../mapeo';

export type DatosPrestamo = {
  readonly clienteId: number;
  readonly condiciones: Condiciones;
  /** `null` para usar las reglas generales de `config`. */
  readonly reglasMora?: ReglasMora | null;
  readonly notas?: string | null;
  /** Si nace de refinanciar otro préstamo. */
  readonly prestamoOrigenId?: number | null;
};

export async function crearPrestamo(
  db: EjecutorSQL,
  datos: DatosPrestamo,
  ahora: Instante,
): Promise<number> {
  const { condiciones: c } = datos;
  const mora = datos.reglasMora ?? null;

  const resultado = await db.runAsync(
    `INSERT INTO prestamos (
       cliente_id, moneda, capital_centavos, tasa_puntos_basicos, tasa_periodo,
       modalidad, frecuencia, cantidad_periodos, fecha_desembolso, vencimiento_capital,
       mora_tipo, mora_puntos_basicos_diarios, mora_centavos_diarios, mora_dias_gracia,
       mora_tope_puntos_basicos, prestamo_origen_id, notas, creado_en, actualizado_en
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    datos.clienteId,
    c.capital.moneda,
    c.capital.centavos,
    c.tasa.puntosBasicos,
    c.tasa.periodo,
    c.modalidad,
    c.frecuencia,
    c.cantidadPeriodos,
    c.fechaDesembolso,
    c.vencimientoCapital,
    mora?.tipo ?? null,
    mora?.puntosBasicosDiarios ?? null,
    mora?.centavosDiarios ?? null,
    mora?.diasDeGracia ?? null,
    mora?.topePuntosBasicos ?? null,
    datos.prestamoOrigenId ?? null,
    datos.notas?.trim() ?? null,
    ahora,
    ahora,
  );
  return resultado.lastInsertRowId;
}

export async function obtenerPrestamo(db: EjecutorSQL, id: number): Promise<Prestamo | null> {
  const fila = await db.getFirstAsync<FilaPrestamo>(
    `SELECT ${COLUMNAS_PRESTAMO} FROM prestamos WHERE id = ?`,
    id,
  );
  return fila ? prestamoDesdeFila(fila) : null;
}

export async function exigirPrestamo(db: EjecutorSQL, id: number): Promise<Prestamo> {
  const prestamo = await obtenerPrestamo(db, id);
  if (!prestamo) {
    throw new PrestamoInexistenteError(`No existe el préstamo ${id}.`);
  }
  return prestamo;
}

export async function prestamosDeCliente(
  db: EjecutorSQL,
  clienteId: number,
  opciones: { soloActivos?: boolean } = {},
): Promise<Prestamo[]> {
  const filtroEstado = opciones.soloActivos ? "AND estado = 'activo'" : '';
  const filas = await db.getAllAsync<FilaPrestamo>(
    `SELECT ${COLUMNAS_PRESTAMO} FROM prestamos
      WHERE cliente_id = ? ${filtroEstado}
      ORDER BY fecha_desembolso DESC, id DESC`,
    clienteId,
  );
  return filas.map(prestamoDesdeFila);
}

/** Los préstamos sobre los que corre el devengo. */
export async function prestamosActivos(db: EjecutorSQL): Promise<Prestamo[]> {
  const filas = await db.getAllAsync<FilaPrestamo>(
    `SELECT ${COLUMNAS_PRESTAMO} FROM prestamos
      WHERE estado = 'activo'
      ORDER BY fecha_desembolso, id`,
  );
  return filas.map(prestamoDesdeFila);
}

/**
 * Cierra o reabre un préstamo. Un préstamo **nunca se elimina**: el cierre guarda su motivo,
 * y los préstamos cerrados son el historial del cliente.
 */
export async function cambiarEstadoPrestamo(
  db: EjecutorSQL,
  id: number,
  estado: EstadoPrestamo,
  motivo: string | null,
  ahora: Instante,
): Promise<void> {
  await db.runAsync(
    'UPDATE prestamos SET estado = ?, motivo_cierre = ?, actualizado_en = ? WHERE id = ?',
    estado,
    motivo,
    ahora,
    id,
  );
}
