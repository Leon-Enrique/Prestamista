/**
 * Lo cobrado y lo pactado de una obligación, componente por componente ("200 de 200").
 *
 * La tarjeta de una obligación muestra su saldo, que en una cuota ya pagada es cero. Esto
 * dice cuánto de ella era interés (ganancia) y cuánto capital, y cuánto se cobró de cada uno.
 */

import { Dato, Texto } from '@/components/ui';
import { pagadoDe, totalDe } from '@/dominio/obligaciones';
import { COMPONENTES, type Componente, type Obligacion } from '@/dominio/tipos';
import { esPositivo, formatear } from '@/nucleo/dinero';

const ETIQUETA: Record<Componente, string> = {
  interes: 'Interés (ganancia)',
  capital: 'Capital',
  mora: 'Penalización',
};

export function DesgloseDeObligacion({ obligacion }: { obligacion: Obligacion }) {
  const componentes = COMPONENTES.filter((c) => esPositivo(totalDe(obligacion, c)));
  if (componentes.length === 0) return null;

  return (
    <>
      {componentes.map((componente) => (
        <Dato key={componente} etiqueta={ETIQUETA[componente]}>
          <Texto style={{ fontVariant: ['tabular-nums'] }}>
            {pagadoDe(obligacion, componente).centavos >= totalDe(obligacion, componente).centavos
              ? `${formatear(totalDe(obligacion, componente))} cobrado`
              : `${formatear(pagadoDe(obligacion, componente))} de ${formatear(totalDe(obligacion, componente))}`}
          </Texto>
        </Dato>
      ))}
    </>
  );
}
