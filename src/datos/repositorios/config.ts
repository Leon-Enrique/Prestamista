/**
 * Configuración del negocio.
 *
 * Las reglas que son decisión del usuario —cómo cobra la mora, cuántos días de gracia da, en
 * qué orden se imputa un pago— viven acá y no en el código. Un valor por defecto escrito en
 * una constante de TypeScript es una regla invisible: nadie sabe que existe hasta que da un
 * número raro.
 */

import {
  COMPONENTES,
  REGLAS_MORA_POR_DEFECTO,
  REGLA_PAGO_ADELANTADO_POR_DEFECTO,
  type Componente,
  type ReglaPagoAdelantado,
  type ReglasMora,
} from '../../dominio/tipos';
import type { Moneda } from '../../nucleo/dinero';
import type { Instante } from '../../nucleo/fechas';
import type { EjecutorSQL } from '../ejecutor';

export type Configuracion = Readonly<Record<string, string>>;

export async function leerConfiguracion(db: EjecutorSQL): Promise<Configuracion> {
  const filas = await db.getAllAsync<{ clave: string; valor: string }>(
    'SELECT clave, valor FROM config',
  );
  return Object.fromEntries(filas.map((fila) => [fila.clave, fila.valor]));
}

export async function escribirConfiguracion(
  db: EjecutorSQL,
  clave: string,
  valor: string,
  ahora: Instante,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO config (clave, valor, actualizado_en) VALUES (?, ?, ?)
     ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    clave,
    valor,
    ahora,
  );
}

function entero(config: Configuracion, clave: string, porDefecto: number): number {
  const valor = Number(config[clave]);
  return Number.isSafeInteger(valor) ? valor : porDefecto;
}

/** Las reglas de mora generales. Un préstamo puede traer las suyas y pisarlas. */
export function reglasMoraDe(config: Configuracion): ReglasMora {
  const tipo = config.mora_tipo;
  return {
    tipo:
      tipo === 'monto_fijo_diario' || tipo === 'porcentaje_diario'
        ? tipo
        : REGLAS_MORA_POR_DEFECTO.tipo,
    puntosBasicosDiarios: entero(
      config,
      'mora_puntos_basicos_diarios',
      REGLAS_MORA_POR_DEFECTO.puntosBasicosDiarios,
    ),
    centavosDiarios: entero(
      config,
      'mora_centavos_diarios',
      REGLAS_MORA_POR_DEFECTO.centavosDiarios,
    ),
    diasDeGracia: entero(config, 'mora_dias_gracia', REGLAS_MORA_POR_DEFECTO.diasDeGracia),
    topePuntosBasicos: entero(
      config,
      'mora_tope_puntos_basicos',
      REGLAS_MORA_POR_DEFECTO.topePuntosBasicos,
    ),
  };
}

/** El orden de los componentes dentro de una obligación: mora → interés → capital. */
export function ordenComponentesDe(config: Configuracion): readonly Componente[] {
  const crudo = (config.orden_componentes ?? '')
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte): parte is Componente =>
      (COMPONENTES as readonly string[]).includes(parte),
    );

  // Si la configuración está incompleta o mal escrita, se completa con los que falten en vez
  // de dejar un componente sin cobrar nunca.
  const faltantes = COMPONENTES.filter((componente) => !crudo.includes(componente));
  return [...crudo, ...faltantes];
}

export function reglaPagoAdelantadoDe(config: Configuracion): ReglaPagoAdelantado {
  return config.regla_pago_adelantado === 'cobrar_periodo_completo'
    ? 'cobrar_periodo_completo'
    : REGLA_PAGO_ADELANTADO_POR_DEFECTO;
}

export function mesesVencimientoCapitalDe(config: Configuracion): number {
  return entero(config, 'meses_vencimiento_capital', 6);
}

export function monedaPreferidaDe(config: Configuracion): Moneda {
  return config.moneda_preferida === 'USD' ? 'USD' : 'BOB';
}

export function diasSinRespaldoParaAvisarDe(config: Configuracion): number {
  return entero(config, 'dias_sin_respaldo_para_avisar', 7);
}

/**
 * El aviso por tasa alta. Vacío por defecto: la tasa es entrada libre y en el rubro se
 * maneja desde 5% hasta 20% mensual, sin un tope de mercado. Esto existe solo si el usuario
 * decide ponerse un límite a sí mismo.
 */
export function avisoTasaPuntosBasicosDe(config: Configuracion): number | null {
  const crudo = config.aviso_tasa_puntos_basicos?.trim();
  if (!crudo) return null;
  const valor = Number(crudo);
  return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
}

/**
 * Código de país para armar los números de WhatsApp. Bolivia por defecto, porque el país
 * está definido; queda configurable para quien preste a alguien de afuera.
 */
/** El nombre con el que la app saluda. Se cambia en Ajustes. */
export function nombreUsuarioDe(config: Configuracion): string {
  return config.nombre_usuario?.trim() || 'Alejandro';
}

export function codigoPaisDe(config: Configuracion): string {
  const crudo = config.codigo_pais?.replace(/\D/g, '');
  return crudo && crudo.length > 0 ? crudo : '591';
}
