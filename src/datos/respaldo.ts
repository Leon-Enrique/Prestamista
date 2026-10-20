/**
 * Respaldo y restauración.
 *
 * Elegir SQLite en el celular compró simplicidad y costo cero. **El precio es este módulo**:
 * un teléfono perdido, robado o mojado sin respaldo es la cartera entera perdida, sin forma
 * de recuperarla. Es la única parte irreversible de toda la app.
 *
 * El respaldo se toma con `serializeAsync()`, o sea **a través de SQLite**, no copiando el
 * archivo. Copiar el archivo a mano con el modo WAL activo dejaría afuera lo último escrito,
 * que todavía vive en el `-wal`: el respaldo parecería correcto y le faltarían los últimos
 * cobros. Esto es una foto consistente.
 *
 * Se conservan varias copias y no solo la última, porque una base corrupta sobrescribiendo
 * la única copia buena es peor que no tener respaldo.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';

import { diasEntre, type Dia, type Instante } from '../nucleo/fechas';
import { exportarCarteraACsv } from './cartera-csv';
import type { Configuracion } from './repositorios/config';
import { escribirConfiguracion } from './repositorios/config';
import { validarContenido, type ValidacionRespaldo } from './restaurar';

export const CARPETA_RESPALDOS = 'respaldos';
export const RESPALDOS_A_CONSERVAR = 5;
export const CLAVE_ULTIMO_RESPALDO = 'ultimo_respaldo';

export type Respaldo = {
  readonly nombre: string;
  readonly uri: string;
  readonly bytes: number;
  readonly modificadoEn: number | null;
};

function carpetaDeRespaldos(): Directory {
  const carpeta = new Directory(Paths.document, CARPETA_RESPALDOS);
  carpeta.create({ intermediates: true, idempotent: true });
  return carpeta;
}

function conDosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/** `prestamista-2026-10-09-1742.db`, o con etiqueta: `...-1742-antes-de-restaurar.db`. */
export function nombreDeRespaldo(fecha: Date, etiqueta?: string): string {
  const partes = [
    fecha.getFullYear(),
    conDosDigitos(fecha.getMonth() + 1),
    conDosDigitos(fecha.getDate()),
    `${conDosDigitos(fecha.getHours())}${conDosDigitos(fecha.getMinutes())}`,
  ].join('-');
  const sufijo = etiqueta ? `-${etiqueta}` : '';
  return `prestamista-${partes}${sufijo}.db`;
}

function describir(archivo: File): Respaldo {
  return {
    nombre: archivo.name,
    uri: archivo.uri,
    bytes: archivo.size,
    modificadoEn: archivo.modificationTime,
  };
}

/** Los respaldos que hay en el dispositivo, del más nuevo al más viejo. */
export function listarRespaldos(): Respaldo[] {
  return carpetaDeRespaldos()
    .list()
    .filter((item): item is File => item instanceof File && item.name.endsWith('.db'))
    .map(describir)
    .sort((a, b) => (b.modificadoEn ?? 0) - (a.modificadoEn ?? 0));
}

/** Borra los más viejos y deja los últimos `RESPALDOS_A_CONSERVAR`. */
function rotar(): void {
  const sobrantes = listarRespaldos().slice(RESPALDOS_A_CONSERVAR);
  for (const respaldo of sobrantes) {
    try {
      new File(respaldo.uri).delete();
    } catch {
      // Si uno no se puede borrar, no vale la pena romper el respaldo que se acaba de tomar.
    }
  }
}

export async function tomarRespaldo(
  db: SQLite.SQLiteDatabase,
  opciones: { etiqueta?: string; ahora?: Instante } = {},
): Promise<Respaldo> {
  const datos = await db.serializeAsync();

  const archivo = new File(carpetaDeRespaldos(), nombreDeRespaldo(new Date(), opciones.etiqueta));
  archivo.create({ overwrite: true });
  archivo.write(datos);

  const ahora = opciones.ahora ?? (new Date().toISOString() as Instante);
  await escribirConfiguracion(db, CLAVE_ULTIMO_RESPALDO, ahora, ahora);

  rotar();
  return describir(archivo);
}

/**
 * Manda el respaldo fuera del dispositivo: WhatsApp, Drive, correo, lo que el usuario use.
 *
 * Una copia que vive solo en el mismo celular **no es un respaldo**: se pierde junto con el
 * teléfono. Esta es la parte que de verdad protege la cartera.
 */
export async function compartirRespaldo(respaldo: Respaldo): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(respaldo.uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: 'Guardar respaldo de la cartera',
  });
  return true;
}

/**
 * Exporta la cartera como planilla y la comparte.
 *
 * Es la otra mitad de la promesa del respaldo: el `.db` sirve para restaurar pero no se
 * puede leer. Si algún día la app no abre, esto se abre en cualquier planilla.
 */
export async function exportarCartera(db: SQLite.SQLiteDatabase): Promise<File> {
  const csv = await exportarCarteraACsv(db);
  const archivo = new File(carpetaDeRespaldos(), `cartera-${nombreDeRespaldo(new Date()).slice(13, -3)}.csv`);
  archivo.create({ overwrite: true });
  // BOM para que las planillas reconozcan los acentos sin preguntar.
  archivo.write(`﻿${csv}`);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(archivo.uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Exportar la cartera',
    });
  }
  return archivo;
}

/**
 * Abre el selector de archivos. Devuelve `null` si el usuario cancela.
 *
 * Usa el selector de `expo-file-system`, que entrega el archivo con permiso de lectura. El de
 * `expo-document-picker` copiaba el archivo a una carpeta que Expo Go no deja leer ("Missing
 * READ permission"), y la restauración fallaba justo cuando más se la necesita.
 */
export async function elegirArchivoDeRespaldo(): Promise<{
  nombre: string;
  bytes: Uint8Array;
} | null> {
  const resultado = await File.pickFileAsync({ mimeTypes: '*/*' });
  if (resultado.canceled) return null;

  const archivo = resultado.result;
  return { nombre: archivo.name, bytes: await archivo.bytes() };
}

/**
 * Mira qué tiene adentro un archivo **sin tocar la base viva**: lo abre como base en memoria.
 * Es lo que permite mostrarle al usuario "este respaldo tiene 12 clientes y 30 préstamos"
 * antes de que decida pisar su cartera con él.
 */
export async function revisarRespaldo(bytes: Uint8Array): Promise<ValidacionRespaldo> {
  let memoria: SQLite.SQLiteDatabase;
  try {
    memoria = await SQLite.deserializeDatabaseAsync(bytes);
  } catch {
    return {
      valido: false,
      motivo: 'El archivo no es una base de datos.',
      version: 0,
      clientes: 0,
      prestamos: 0,
      pagos: 0,
    };
  }
  try {
    return await validarContenido(memoria);
  } finally {
    await memoria.closeAsync();
  }
}

/**
 * Días desde el último respaldo. `null` si nunca se hizo uno — que es el caso que más hay
 * que avisar.
 */
export function diasSinRespaldo(configuracion: Configuracion, hoy: Dia): number | null {
  const ultimo = configuracion[CLAVE_ULTIMO_RESPALDO]?.trim();
  if (!ultimo) return null;

  const fecha = new Date(ultimo);
  if (Number.isNaN(fecha.getTime())) return null;

  const dia = [
    fecha.getFullYear(),
    conDosDigitos(fecha.getMonth() + 1),
    conDosDigitos(fecha.getDate()),
  ].join('-') as Dia;

  return Math.max(0, diasEntre(dia, hoy));
}
