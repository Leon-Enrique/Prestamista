import type { Cliente } from '../../dominio/tipos';
import { ClienteInexistenteError } from '../../nucleo/errores';
import type { Instante } from '../../nucleo/fechas';
import type { EjecutorSQL } from '../ejecutor';
import { aEntero, clienteDesdeFila, COLUMNAS_CLIENTE, type FilaCliente } from '../mapeo';

export type DatosCliente = {
  readonly nombre: string;
  readonly ci?: string | null;
  readonly telefono?: string | null;
  readonly direccion?: string | null;
  readonly referencias?: string | null;
  readonly notas?: string | null;
};

export async function crearCliente(
  db: EjecutorSQL,
  datos: DatosCliente,
  ahora: Instante,
): Promise<number> {
  const resultado = await db.runAsync(
    `INSERT INTO clientes (nombre, ci, telefono, direccion, referencias, notas, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    datos.nombre.trim(),
    datos.ci?.trim() ?? null,
    datos.telefono?.trim() ?? null,
    datos.direccion?.trim() ?? null,
    datos.referencias?.trim() ?? null,
    datos.notas?.trim() ?? null,
    ahora,
    ahora,
  );
  return resultado.lastInsertRowId;
}

export async function obtenerCliente(db: EjecutorSQL, id: number): Promise<Cliente | null> {
  const fila = await db.getFirstAsync<FilaCliente>(
    `SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE id = ?`,
    id,
  );
  return fila ? clienteDesdeFila(fila) : null;
}

export async function exigirCliente(db: EjecutorSQL, id: number): Promise<Cliente> {
  const cliente = await obtenerCliente(db, id);
  if (!cliente) {
    throw new ClienteInexistenteError(`No existe el cliente ${id}.`);
  }
  return cliente;
}

export async function listarClientes(
  db: EjecutorSQL,
  opciones: { busqueda?: string; incluirInactivos?: boolean } = {},
): Promise<Cliente[]> {
  const condiciones: string[] = [];
  const parametros: (string | number)[] = [];

  if (!opciones.incluirInactivos) {
    condiciones.push('activo = 1');
  }
  if (opciones.busqueda?.trim()) {
    condiciones.push('(nombre LIKE ? OR ci LIKE ? OR telefono LIKE ?)');
    const patron = `%${opciones.busqueda.trim()}%`;
    parametros.push(patron, patron, patron);
  }

  const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  const filas = await db.getAllAsync<FilaCliente>(
    `SELECT ${COLUMNAS_CLIENTE} FROM clientes ${donde} ORDER BY nombre COLLATE NOCASE`,
    ...parametros,
  );
  return filas.map(clienteDesdeFila);
}

export async function actualizarCliente(
  db: EjecutorSQL,
  id: number,
  datos: DatosCliente,
  ahora: Instante,
): Promise<void> {
  await db.runAsync(
    `UPDATE clientes
        SET nombre = ?, ci = ?, telefono = ?, direccion = ?, referencias = ?, notas = ?,
            actualizado_en = ?
      WHERE id = ?`,
    datos.nombre.trim(),
    datos.ci?.trim() ?? null,
    datos.telefono?.trim() ?? null,
    datos.direccion?.trim() ?? null,
    datos.referencias?.trim() ?? null,
    datos.notas?.trim() ?? null,
    ahora,
    id,
  );
}

/**
 * Un cliente no se borra: se desactiva. Sus préstamos y pagos siguen en el historial, que es
 * justo para lo que existen.
 */
export async function desactivarCliente(
  db: EjecutorSQL,
  id: number,
  ahora: Instante,
): Promise<void> {
  await db.runAsync(
    'UPDATE clientes SET activo = ?, actualizado_en = ? WHERE id = ?',
    aEntero(false),
    ahora,
    id,
  );
}
