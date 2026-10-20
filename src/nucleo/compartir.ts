/**
 * Mandar un texto por WhatsApp, o por donde el usuario elija.
 *
 * **La app nunca envía sola.** Abre WhatsApp con el mensaje ya escrito en el chat del
 * cliente, y apretar enviar es siempre una decisión del usuario, con el texto delante. No
 * existe forma de que un mensaje sobre la deuda de alguien salga sin que él lo vea.
 *
 * Si WhatsApp no está instalado, `openURL` falla y se cae al menú de compartir del sistema:
 * así el mensaje igual sirve por SMS, Telegram o lo que tenga. Se intenta y se captura el
 * error en vez de preguntar con `canOpenURL`, porque desde Android 11 esa consulta devuelve
 * `false` para esquemas no declarados aunque la app esté instalada.
 */

import * as Linking from 'expo-linking';
import { Share } from 'react-native';

export type ResultadoEnvio = 'whatsapp' | 'compartir' | 'cancelado';

/** Abre el menú de compartir del sistema con el texto. */
export async function compartirTexto(texto: string): Promise<boolean> {
  const resultado = await Share.share({ message: texto });
  return resultado.action !== Share.dismissedAction;
}

/**
 * Abre el chat de WhatsApp de ese número con el mensaje escrito. Si no se puede, cae al menú
 * de compartir.
 *
 * `numero` ya viene normalizado por `aNumeroDeWhatsApp()` del dominio: solo dígitos y con
 * código de país.
 */
export async function enviarPorWhatsApp(
  numero: string | null,
  texto: string,
): Promise<ResultadoEnvio> {
  if (numero !== null) {
    try {
      await Linking.openURL(
        `whatsapp://send?phone=${numero}&text=${encodeURIComponent(texto)}`,
      );
      return 'whatsapp';
    } catch {
      // Sin WhatsApp instalado: sigue al menú de compartir.
    }
  }

  return (await compartirTexto(texto)) ? 'compartir' : 'cancelado';
}
