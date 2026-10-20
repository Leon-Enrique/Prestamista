/**
 * Los mensajes que se le mandan al cliente.
 *
 * Están acá, puros y probados, por dos razones. Una: el texto que le llega a una persona
 * sobre su deuda no es un detalle de presentación, es parte del negocio — un recordatorio
 * mal escrito pierde un cliente. Dos: así se puede verificar que los montos del mensaje son
 * exactamente los de la cartera, sin abrir WhatsApp.
 *
 * **La app no manda nada sola.** Estas funciones arman el texto; abrir WhatsApp y apretar
 * enviar es siempre una decisión del usuario, con el mensaje delante.
 *
 * El tono es deliberado: factual y sin presionar. Alguien que se atrasó ya lo sabe, y el
 * negocio vive de que vuelva.
 */

import { esPositivo, formatear, type Dinero } from '../nucleo/dinero';
import { formatearDia, type Dia } from '../nucleo/fechas';
import type { Componente } from './tipos';

/** `"Juan Pérez"` → `"Juan"`. Tratar a alguien por su nombre cambia cómo se lee el mensaje. */
export function primerNombre(nombreCompleto: string): string {
  const primero = nombreCompleto.trim().split(/\s+/)[0] ?? '';
  return primero || 'Hola';
}

const ETIQUETA_COMPONENTE: Record<Componente, string> = {
  mora: 'Penalización',
  interes: 'Interés',
  capital: 'Capital',
};

const ORDEN: readonly Componente[] = ['mora', 'interes', 'capital'];

export function mensajeDeRecibo(params: {
  cliente: string;
  monto: Dinero;
  fecha: Dia;
  desglose: Record<Componente, Dinero>;
  saldoRestante: Dinero;
  prestamoCerrado: boolean;
}): string {
  const lineas: string[] = [
    `Hola ${primerNombre(params.cliente)}.`,
    '',
    `Recibí tu pago de ${formatear(params.monto)} del ${formatearDia(params.fecha)}.`,
  ];

  // Solo los componentes que de verdad se movieron: una línea en cero no informa nada.
  const detalle = ORDEN.filter((componente) => esPositivo(params.desglose[componente])).map(
    (componente) => `- ${ETIQUETA_COMPONENTE[componente]}: ${formatear(params.desglose[componente])}`,
  );

  if (detalle.length > 0) {
    lineas.push('', ...detalle);
  }

  lineas.push('');
  if (params.prestamoCerrado) {
    lineas.push('Con esto queda saldado. Gracias.');
  } else {
    lineas.push(`Te queda un saldo de ${formatear(params.saldoRestante)}.`, '', 'Gracias.');
  }

  return lineas.join('\n');
}

export function mensajeDeRecordatorio(params: {
  cliente: string;
  vencido: Dinero;
  total: Dinero;
  vencimiento: Dia | null;
  diasDeAtraso: number;
}): string {
  const lineas: string[] = [`Hola ${primerNombre(params.cliente)}, ¿cómo andás?`, ''];

  if (esPositivo(params.vencido) && params.vencimiento !== null) {
    const dias =
      params.diasDeAtraso === 1 ? 'hace 1 día' : `hace ${params.diasDeAtraso} días`;
    lineas.push(
      `Te recuerdo que el ${formatearDia(params.vencimiento)} venció un pago de ` +
        `${formatear(params.vencido)} (${dias}).`,
    );
  } else if (params.vencimiento !== null) {
    lineas.push(
      `Te recuerdo que el ${formatearDia(params.vencimiento)} tenés un pago de ` +
        `${formatear(params.total)}.`,
    );
  } else {
    lineas.push(`Te recuerdo que tenés un saldo pendiente de ${formatear(params.total)}.`);
  }

  // Si lo vencido es solo una parte, conviene que sepa el total: evita la conversación de
  // "pero yo pensaba que ya estaba".
  if (esPositivo(params.vencido) && params.total.centavos > params.vencido.centavos) {
    lineas.push('', `El total pendiente es ${formatear(params.total)}.`);
  }

  lineas.push('', 'Si necesitás acomodarlo, avisame.');
  return lineas.join('\n');
}

/**
 * Lleva un teléfono anotado a mano al formato que necesita WhatsApp: solo dígitos, con
 * código de país adelante.
 *
 * Los teléfonos se cargan como la gente los dicta —`70000000`, `+591 7000-0000`,
 * `591 70000000`— y todos tienen que terminar igual. Devuelve `null` si no hay nada
 * aprovechable, para que la pantalla ofrezca compartir por otro lado en vez de abrir un chat
 * con un número inventado.
 */
export function aNumeroDeWhatsApp(
  telefono: string | null | undefined,
  codigoPais: string,
): string | null {
  if (!telefono) return null;

  const soloDigitos = telefono.replace(/\D/g, '');
  if (soloDigitos.length === 0) return null;

  const pais = codigoPais.replace(/\D/g, '');

  // Ya viene con código de país: se respeta tal cual.
  if (pais.length > 0 && soloDigitos.startsWith(pais) && soloDigitos.length > pais.length) {
    return soloDigitos;
  }

  // Los ceros de adelante son del marcado local y no van en el formato internacional.
  const local = soloDigitos.replace(/^0+/, '');
  if (local.length === 0) return null;

  return `${pais}${local}`;
}
