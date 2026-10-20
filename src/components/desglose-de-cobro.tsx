/**
 * El reparto de un cobro: cuánto fue ganancia (interés, penalización) y cuánto capital.
 * Es lo que contesta "¿cuánto gané en este pago?".
 */

import { Dato, Monto } from '@/components/ui';
import type { CobroDetallado } from '@/datos/consultas';
import { esPositivo, formatear } from '@/nucleo/dinero';

export function DesgloseDeCobro({ cobro }: { cobro: CobroDetallado }) {
  return (
    <>
      <Dato etiqueta="Ganancia: interés">
        <Monto valor={cobro.interes} />
      </Dato>
      {esPositivo(cobro.penalizacion) ? (
        <Dato etiqueta="Ganancia: penalización">
          <Monto valor={cobro.penalizacion} />
        </Dato>
      ) : null}
      <Dato etiqueta="Capital recuperado">
        <Monto valor={cobro.capital} />
      </Dato>
    </>
  );
}

/** "Interés Bs 150,00 · Capital Bs 1.500,00", sin las partes en cero. */
export function textoReparto(cobro: CobroDetallado): string {
  return [
    esPositivo(cobro.interes) ? `Interés ${formatear(cobro.interes)}` : null,
    esPositivo(cobro.penalizacion) ? `Penalización ${formatear(cobro.penalizacion)}` : null,
    esPositivo(cobro.capital) ? `Capital ${formatear(cobro.capital)}` : null,
  ]
    .filter((parte) => parte !== null)
    .join(' · ');
}
