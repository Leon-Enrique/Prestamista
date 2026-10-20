/**
 * Exportación legible de la cartera.
 *
 * El respaldo `.db` sirve para restaurar, pero no se puede leer. Esto es la otra mitad de la
 * promesa: **si algún día la app no abre, o se cambia de sistema, el usuario tiene que poder
 * ver quién le debe cuánto sin esta app**. Un archivo que se abre en cualquier planilla.
 *
 * Separador `;` y no `,` a propósito: los montos van con coma decimal (Bs 6.000,00), que es
 * como se escribe acá, y con `,` de separador la planilla partiría cada monto en dos
 * columnas.
 */

import { dinero, formatear, type Moneda } from '../nucleo/dinero';
import { formatearDia, type Dia } from '../nucleo/fechas';
import type { EjecutorSQL } from './ejecutor';

const SEPARADOR = ';';

/** Envuelve en comillas si hace falta y duplica las comillas internas. */
export function escaparCampo(valor: string): string {
  if (/[";\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

export type FilaCartera = {
  readonly cliente: string;
  readonly ci: string | null;
  readonly telefono: string | null;
  readonly prestamo_id: number;
  readonly moneda: string;
  readonly modalidad: string;
  readonly tasa_puntos_basicos: number;
  readonly tasa_periodo: string;
  readonly estado_prestamo: string;
  readonly tipo: string;
  readonly numero: number | null;
  readonly vencimiento: string | null;
  readonly capital_centavos: number;
  readonly interes_centavos: number;
  readonly mora_centavos: number;
  readonly pagado_capital_centavos: number;
  readonly pagado_interes_centavos: number;
  readonly pagado_mora_centavos: number;
  readonly estado: string;
};

const ENCABEZADOS = [
  'Cliente',
  'CI',
  'Teléfono',
  'Préstamo',
  'Moneda',
  'Modalidad',
  'Tasa',
  'Estado del préstamo',
  'Concepto',
  'Nº',
  'Vence',
  'Capital',
  'Interés',
  'Mora',
  'Total',
  'Pagado',
  'Saldo',
  'Estado',
];

const ETIQUETA_TIPO: Record<string, string> = {
  cuota: 'Cuota',
  interes: 'Interés',
  capital: 'Capital',
  mora: 'Mora',
};

export function carteraACsv(filas: readonly FilaCartera[]): string {
  const lineas = [ENCABEZADOS.map(escaparCampo).join(SEPARADOR)];

  for (const fila of filas) {
    const moneda = fila.moneda as Moneda;
    const monto = (centavos: number) => formatear(dinero(centavos, moneda), { sinSimbolo: true });

    const total =
      fila.capital_centavos + fila.interes_centavos + fila.mora_centavos;
    const pagado =
      fila.pagado_capital_centavos +
      fila.pagado_interes_centavos +
      fila.pagado_mora_centavos;

    const campos = [
      fila.cliente,
      fila.ci ?? '',
      fila.telefono ?? '',
      String(fila.prestamo_id),
      fila.moneda,
      fila.modalidad,
      `${(fila.tasa_puntos_basicos / 100).toString().replace('.', ',')}% ${fila.tasa_periodo}`,
      fila.estado_prestamo,
      ETIQUETA_TIPO[fila.tipo] ?? fila.tipo,
      fila.numero === null ? '' : String(fila.numero),
      fila.vencimiento === null ? 'sin vencimiento' : formatearDia(fila.vencimiento as Dia),
      monto(fila.capital_centavos),
      monto(fila.interes_centavos),
      monto(fila.mora_centavos),
      monto(total),
      monto(pagado),
      monto(total - pagado),
      fila.estado,
    ];

    lineas.push(campos.map(escaparCampo).join(SEPARADOR));
  }

  // Terminar con salto de línea: hay planillas que se comen la última fila si falta.
  return `${lineas.join('\r\n')}\r\n`;
}

export async function filasDeCartera(db: EjecutorSQL): Promise<FilaCartera[]> {
  return db.getAllAsync<FilaCartera>(`
    SELECT
      c.nombre        AS cliente,
      c.ci            AS ci,
      c.telefono      AS telefono,
      p.id            AS prestamo_id,
      p.moneda        AS moneda,
      p.modalidad     AS modalidad,
      p.tasa_puntos_basicos AS tasa_puntos_basicos,
      p.tasa_periodo  AS tasa_periodo,
      p.estado        AS estado_prestamo,
      o.tipo          AS tipo,
      o.numero        AS numero,
      o.vencimiento   AS vencimiento,
      o.capital_centavos        AS capital_centavos,
      o.interes_centavos        AS interes_centavos,
      o.mora_centavos           AS mora_centavos,
      o.pagado_capital_centavos AS pagado_capital_centavos,
      o.pagado_interes_centavos AS pagado_interes_centavos,
      o.pagado_mora_centavos    AS pagado_mora_centavos,
      o.estado        AS estado
    FROM obligaciones o
    JOIN prestamos p ON p.id = o.prestamo_id
    JOIN clientes  c ON c.id = p.cliente_id
    ORDER BY c.nombre COLLATE NOCASE, p.id,
             o.vencimiento IS NULL, o.vencimiento, o.numero, o.id
  `);
}

export async function exportarCarteraACsv(db: EjecutorSQL): Promise<string> {
  return carteraACsv(await filasDeCartera(db));
}
