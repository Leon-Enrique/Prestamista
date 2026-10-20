/**
 * Comprueba que los saldos cacheados coincidan con el libro.
 *
 * El libro es la verdad; las columnas `pagado_*` de una obligación son una copia que existe
 * por velocidad. La invariante es simple y tiene que cumplirse siempre:
 *
 *   **lo pagado de un componente = la suma de las imputaciones de los pagos no revertidos**
 *
 * Si los dos números se separan, hay un bug en algún servicio de escritura, y en una app de
 * plata eso se tiene que poder detectar sin esperar a que un cliente se queje. El checklist
 * de `pre-release` pide justamente esto.
 */

import { dinero, type Dinero, type Moneda } from '../nucleo/dinero';
import type { Componente } from '../dominio/tipos';
import type { EjecutorSQL } from './ejecutor';

export type Descuadre = {
  readonly obligacionId: number;
  readonly prestamoId: number;
  readonly componente: Componente;
  /** Lo que dice la columna cacheada de la obligación. */
  readonly enLaObligacion: Dinero;
  /** Lo que dicen las imputaciones de los pagos que siguen vigentes. */
  readonly enElLibro: Dinero;
};

type FilaVerificacion = {
  id: number;
  prestamo_id: number;
  moneda: string;
  pagado_mora_centavos: number;
  pagado_interes_centavos: number;
  pagado_capital_centavos: number;
  libro_mora: number;
  libro_interes: number;
  libro_capital: number;
};

export async function verificarSaldos(db: EjecutorSQL): Promise<Descuadre[]> {
  const filas = await db.getAllAsync<FilaVerificacion>(`
    SELECT
      o.id                      AS id,
      o.prestamo_id             AS prestamo_id,
      o.moneda                  AS moneda,
      o.pagado_mora_centavos    AS pagado_mora_centavos,
      o.pagado_interes_centavos AS pagado_interes_centavos,
      o.pagado_capital_centavos AS pagado_capital_centavos,
      COALESCE(SUM(CASE WHEN i.componente = 'mora'    AND p.revertido_en IS NULL
                        THEN i.monto_centavos ELSE 0 END), 0) AS libro_mora,
      COALESCE(SUM(CASE WHEN i.componente = 'interes' AND p.revertido_en IS NULL
                        THEN i.monto_centavos ELSE 0 END), 0) AS libro_interes,
      COALESCE(SUM(CASE WHEN i.componente = 'capital' AND p.revertido_en IS NULL
                        THEN i.monto_centavos ELSE 0 END), 0) AS libro_capital
    FROM obligaciones o
    LEFT JOIN imputaciones i ON i.obligacion_id = o.id
    LEFT JOIN pagos p        ON p.id = i.pago_id
    GROUP BY o.id
  `);

  const descuadres: Descuadre[] = [];

  for (const fila of filas) {
    const moneda = fila.moneda as Moneda;
    const comparaciones: [Componente, number, number][] = [
      ['mora', fila.pagado_mora_centavos, fila.libro_mora],
      ['interes', fila.pagado_interes_centavos, fila.libro_interes],
      ['capital', fila.pagado_capital_centavos, fila.libro_capital],
    ];

    for (const [componente, enLaObligacion, enElLibro] of comparaciones) {
      if (enLaObligacion !== enElLibro) {
        descuadres.push({
          obligacionId: fila.id,
          prestamoId: fila.prestamo_id,
          componente,
          enLaObligacion: dinero(enLaObligacion, moneda),
          enElLibro: dinero(enElLibro, moneda),
        });
      }
    }
  }

  return descuadres;
}

export type ResumenVerificacion = {
  readonly cuadra: boolean;
  readonly descuadres: readonly Descuadre[];
};

export async function verificar(db: EjecutorSQL): Promise<ResumenVerificacion> {
  const descuadres = await verificarSaldos(db);
  return { cuadra: descuadres.length === 0, descuadres };
}
