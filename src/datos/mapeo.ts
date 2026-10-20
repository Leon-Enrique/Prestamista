/**
 * Traducción entre filas de SQLite y tipos del dominio.
 *
 * Es la única capa que sabe que la plata se guarda como `INTEGER` de centavos y las fechas
 * como texto. Hacia arriba solo circulan `Dinero`, `Dia` y los tipos del dominio; así, un
 * servicio no puede confundir centavos con unidades ni un día con un instante.
 */

import {
  dinero,
  tasa,
  type Dinero,
  type Moneda,
  type PeriodoTasa,
} from '../nucleo/dinero';
import { dia, type Dia, type Frecuencia } from '../nucleo/fechas';
import type {
  Cliente,
  Condiciones,
  EstadoObligacion,
  EstadoPrestamo,
  Modalidad,
  Obligacion,
  Prestamo,
  ReglasMora,
  TipoObligacion,
} from '../dominio/tipos';

const aBooleano = (valor: number): boolean => valor !== 0;
export const aEntero = (valor: boolean): number => (valor ? 1 : 0);

const aDia = (valor: string | null): Dia | null => (valor === null ? null : dia(valor));

// --- Cliente --------------------------------------------------------------------------

export type FilaCliente = {
  id: number;
  nombre: string;
  ci: string | null;
  telefono: string | null;
  direccion: string | null;
  referencias: string | null;
  notas: string | null;
  activo: number;
};

export function clienteDesdeFila(fila: FilaCliente): Cliente {
  return {
    id: fila.id,
    nombre: fila.nombre,
    ci: fila.ci,
    telefono: fila.telefono,
    direccion: fila.direccion,
    referencias: fila.referencias,
    notas: fila.notas,
    activo: aBooleano(fila.activo),
  };
}

// --- Préstamo -------------------------------------------------------------------------

export type FilaPrestamo = {
  id: number;
  cliente_id: number;
  moneda: string;
  capital_centavos: number;
  tasa_puntos_basicos: number;
  tasa_periodo: string;
  modalidad: string;
  frecuencia: string;
  cantidad_periodos: number | null;
  fecha_desembolso: string;
  vencimiento_capital: string | null;
  mora_tipo: string | null;
  mora_puntos_basicos_diarios: number | null;
  mora_centavos_diarios: number | null;
  mora_dias_gracia: number | null;
  mora_tope_puntos_basicos: number | null;
  estado: string;
  prestamo_origen_id: number | null;
  motivo_cierre: string | null;
  notas: string | null;
};

export function prestamoDesdeFila(fila: FilaPrestamo): Prestamo {
  const moneda = fila.moneda as Moneda;

  const condiciones: Condiciones = {
    capital: dinero(fila.capital_centavos, moneda),
    tasa: tasa(fila.tasa_puntos_basicos, fila.tasa_periodo as PeriodoTasa),
    modalidad: fila.modalidad as Modalidad,
    frecuencia: fila.frecuencia as Frecuencia,
    cantidadPeriodos: fila.cantidad_periodos,
    fechaDesembolso: dia(fila.fecha_desembolso),
    vencimientoCapital: aDia(fila.vencimiento_capital),
  };

  // Si el préstamo no tiene reglas propias, el servicio usa las de `config`.
  const reglasMora: ReglasMora | null =
    fila.mora_tipo === null
      ? null
      : {
          tipo: fila.mora_tipo as ReglasMora['tipo'],
          puntosBasicosDiarios: fila.mora_puntos_basicos_diarios ?? 0,
          centavosDiarios: fila.mora_centavos_diarios ?? 0,
          diasDeGracia: fila.mora_dias_gracia ?? 0,
          topePuntosBasicos: fila.mora_tope_puntos_basicos ?? 0,
        };

  return {
    id: fila.id,
    clienteId: fila.cliente_id,
    condiciones,
    reglasMora,
    estado: fila.estado as EstadoPrestamo,
    prestamoOrigenId: fila.prestamo_origen_id,
    motivoCierre: fila.motivo_cierre,
    notas: fila.notas,
  };
}

/** La moneda de un préstamo vive en su capital; no hay una constante global. */
export const monedaDe = (prestamo: Prestamo): Moneda => prestamo.condiciones.capital.moneda;

// --- Obligación -----------------------------------------------------------------------

export type FilaObligacion = {
  id: number;
  prestamo_id: number;
  tipo: string;
  numero: number | null;
  vencimiento: string | null;
  moneda: string;
  capital_centavos: number;
  interes_centavos: number;
  mora_centavos: number;
  pagado_capital_centavos: number;
  pagado_interes_centavos: number;
  pagado_mora_centavos: number;
  estado: string;
  obligacion_origen_id: number | null;
  periodo: string | null;
};

export function obligacionDesdeFila(fila: FilaObligacion): Obligacion {
  const moneda = fila.moneda as Moneda;
  const monto = (centavos: number): Dinero => dinero(centavos, moneda);

  return {
    id: fila.id,
    prestamoId: fila.prestamo_id,
    tipo: fila.tipo as TipoObligacion,
    numero: fila.numero,
    vencimiento: aDia(fila.vencimiento),
    moneda,
    capital: monto(fila.capital_centavos),
    interes: monto(fila.interes_centavos),
    mora: monto(fila.mora_centavos),
    pagadoCapital: monto(fila.pagado_capital_centavos),
    pagadoInteres: monto(fila.pagado_interes_centavos),
    pagadoMora: monto(fila.pagado_mora_centavos),
    estado: fila.estado as EstadoObligacion,
    obligacionOrigenId: fila.obligacion_origen_id,
  };
}

/** Las columnas de una obligación, para no repetir la lista en cada consulta. */
export const COLUMNAS_OBLIGACION = `
  id, prestamo_id, tipo, numero, vencimiento, moneda,
  capital_centavos, interes_centavos, mora_centavos,
  pagado_capital_centavos, pagado_interes_centavos, pagado_mora_centavos,
  estado, obligacion_origen_id, periodo
`;

export const COLUMNAS_PRESTAMO = `
  id, cliente_id, moneda, capital_centavos, tasa_puntos_basicos, tasa_periodo,
  modalidad, frecuencia, cantidad_periodos, fecha_desembolso, vencimiento_capital,
  mora_tipo, mora_puntos_basicos_diarios, mora_centavos_diarios, mora_dias_gracia,
  mora_tope_puntos_basicos, estado, prestamo_origen_id, motivo_cierre, notas
`;

export const COLUMNAS_CLIENTE = `
  id, nombre, ci, telefono, direccion, referencias, notas, activo
`;
