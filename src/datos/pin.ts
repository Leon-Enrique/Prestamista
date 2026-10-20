/**
 * Bloqueo de la app: PIN y huella.
 *
 * La app guarda nombres, carnets, teléfonos y deudas de personas reales. No es una libreta
 * de compras: si alguien levanta el teléfono desbloqueado, no debería poder leer quién le
 * debe cuánto a quién.
 *
 * El PIN vive en **SecureStore**, que en Android lo guarda cifrado con el Keystore del
 * sistema, fuera del alcance de otras apps y de un respaldo del teléfono. Nunca en la base
 * de datos: la base se exporta como respaldo y viaja por WhatsApp.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const CLAVE_PIN = 'prestamista_pin';

export const LARGO_MINIMO_PIN = 4;

export async function hayPinDefinido(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(CLAVE_PIN)) !== null;
  } catch {
    // SecureStore puede fallar en un emulador sin Keystore: mejor dejar entrar que dejar
    // al usuario afuera de su propia cartera.
    return false;
  }
}

export function pinEsValido(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= LARGO_MINIMO_PIN;
}

export async function definirPin(pin: string): Promise<void> {
  if (!pinEsValido(pin)) {
    throw new Error(`El PIN debe tener al menos ${LARGO_MINIMO_PIN} números.`);
  }
  await SecureStore.setItemAsync(CLAVE_PIN, pin);
}

export async function verificarPin(pin: string): Promise<boolean> {
  const guardado = await SecureStore.getItemAsync(CLAVE_PIN);
  return guardado !== null && guardado === pin;
}

export async function quitarPin(): Promise<void> {
  await SecureStore.deleteItemAsync(CLAVE_PIN);
}

/** Si el teléfono tiene lector de huella o rostro **y** el usuario lo tiene configurado. */
export async function hayBiometria(): Promise<boolean> {
  try {
    const [hardware, registrada] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && registrada;
  } catch {
    return false;
  }
}

/**
 * Pide la huella. Devuelve `false` si falla o si el usuario cancela — y en ese caso la
 * pantalla de bloqueo sigue ofreciendo el PIN, que es la única forma de no quedar encerrado
 * afuera si el lector deja de andar.
 */
export async function autenticarConBiometria(): Promise<boolean> {
  try {
    const resultado = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Desbloquear Prestamista',
      cancelLabel: 'Usar PIN',
      disableDeviceFallback: true,
    });
    return resultado.success;
  } catch {
    return false;
  }
}
