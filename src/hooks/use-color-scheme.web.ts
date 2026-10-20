import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * En web el render estático no conoce el tema del navegador, así que hasta que hidrata se
 * devuelve `light`.
 *
 * Usa `useSyncExternalStore` en vez de `useState` + `useEffect`: llamar a `setState` dentro
 * del cuerpo de un efecto dispara renders en cascada, y el lint de React lo marca como error.
 * Acá el "store externo" es simplemente "ya hidraté", que en el servidor es `false` y en el
 * cliente es `true` desde el primer momento.
 */
const suscribirse = () => () => {};
const hidratadoEnCliente = () => true;
const hidratadoEnServidor = () => false;

export function useColorScheme() {
  const hidratado = useSyncExternalStore(
    suscribirse,
    hidratadoEnCliente,
    hidratadoEnServidor,
  );
  const esquema = useRNColorScheme();

  return hidratado ? esquema : 'light';
}
