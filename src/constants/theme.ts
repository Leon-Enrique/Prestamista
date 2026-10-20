/**
 * Colores, tipografía y espaciado.
 *
 * Los colores estructurales van en inglés porque son convención del template; los
 * **semánticos van en español** porque codifican significado del negocio: una obligación
 * vencida, una al día, la mora. Son los que hacen que la cartera se lea de un vistazo,
 * estando de pie y con alguien esperando enfrente.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Paleta de la marca: charcoal #1A1A1A, gold #D4AF37, emerald #065F46, cream #F5F1E8 y
 * off white #FAFAF7. En oscuro el fondo es charcoal con acentos dorados; en claro, off white
 * con tarjetas cream. Los colores de texto sobre fondo oscuro se aclaran (el emerald puro no
 * se lee sobre charcoal), sin salir de la misma familia.
 */
export const Colors = {
  light: {
    text: '#1A1A1A',
    background: '#FAFAF7',
    backgroundElement: '#F5F1E8',
    backgroundSelected: '#EBE4D3',
    textSecondary: '#6B6457',
    borde: '#E3DCCB',

    primario: '#D4AF37',
    primarioTexto: '#1A1A1A',
    // Dorado oscuro para íconos y texto sobre fondo claro: el dorado puro no se distingue.
    primarioTinta: '#8A6D14',

    vencido: '#B42318',
    vencidoSuave: '#FBEAE7',
    alDia: '#065F46',
    alDiaSuave: '#E3EFE9',
    aviso: '#7A5F0F',
    avisoSuave: '#F7EFD6',
    neutroSuave: '#EFEADF',
  },
  dark: {
    text: '#FAFAF7',
    background: '#1A1A1A',
    backgroundElement: '#242424',
    backgroundSelected: '#2F2F2F',
    textSecondary: '#B5AE9F',
    borde: '#34322E',

    primario: '#D4AF37',
    primarioTexto: '#1A1A1A',
    primarioTinta: '#D4AF37',

    vencido: '#F2857A',
    vencidoSuave: '#33191A',
    alDia: '#4CC79A',
    alDiaSuave: '#0E2A20',
    aviso: '#D4AF37',
    avisoSuave: '#2B2513',
    neutroSuave: '#2A2926',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type Tema = typeof Colors.light;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
