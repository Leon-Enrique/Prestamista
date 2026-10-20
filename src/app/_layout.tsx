import {
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_700Bold,
  useFonts,
} from '@expo-google-fonts/playfair-display';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { Bloqueo } from '@/components/bloqueo';
import { Boton, Cargando, Texto } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { ProveedorBase } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

export default function LayoutRaiz() {
  const esquema = useColorScheme();
  const [fuentesListas, errorDeFuentes] = useFonts({
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_700Bold,
  });
  // Si la fuente no carga, la app sigue con la del sistema: no vale la pena trabarse por eso.
  const listo = fuentesListas || errorDeFuentes !== null;

  useEffect(() => {
    // Se oculta en cuanto están las fuentes; lo que viene después es la apertura de la base,
    // que tiene su propia pantalla con texto en vez de un splash congelado.
    if (listo) void SplashScreen.hideAsync();
  }, [listo]);

  if (!listo) return null;

  return (
    <ThemeProvider value={esquema === 'dark' ? DarkTheme : DefaultTheme}>
      <ProveedorBase
        mientrasCarga={<PantallaCarga />}
        alFallar={(error, reintentar) => (
          <PantallaError error={error} reintentar={reintentar} />
        )}>
        <Bloqueo>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="cliente/nuevo"
              options={{ title: 'Nuevo cliente', presentation: 'modal' }}
            />
            <Stack.Screen name="cliente/[id]" options={{ title: 'Cliente' }} />
            <Stack.Screen
              name="cliente/editar"
              options={{ title: 'Editar cliente', presentation: 'modal' }}
            />
            <Stack.Screen name="prestamo/nuevo" options={{ title: 'Nuevo préstamo' }} />
            <Stack.Screen name="prestamo/[id]" options={{ title: 'Préstamo' }} />
            <Stack.Screen name="prestamo/refinanciar" options={{ title: 'Refinanciar' }} />
            <Stack.Screen
              name="caja-movimiento"
              options={{ title: 'Movimiento de caja', presentation: 'modal' }}
            />
            <Stack.Screen
              name="caja-arqueo"
              options={{ title: 'Arqueo de caja', presentation: 'modal' }}
            />
            <Stack.Screen
              name="obligacion-ajustar"
              options={{ title: 'Ajustar cuota', presentation: 'modal' }}
            />
            <Stack.Screen
              name="cobrar/[prestamoId]"
              options={{ title: 'Registrar cobro', presentation: 'modal' }}
            />
          </Stack>
        </Bloqueo>
      </ProveedorBase>
    </ThemeProvider>
  );
}

function PantallaCarga() {
  const tema = useTheme();
  return (
    <View style={[styles.centro, { backgroundColor: tema.background }]}>
      <Cargando texto="Abriendo la cartera…" />
    </View>
  );
}

/**
 * Si la base no abre, el usuario tiene que entender qué pasó y poder reintentar. Quedarse en
 * una pantalla en blanco con la cartera adentro es inaceptable.
 */
function PantallaError({ error, reintentar }: { error: Error; reintentar: () => void }) {
  const tema = useTheme();
  return (
    <View style={[styles.centro, { backgroundColor: tema.background }]}>
      <Texto variante="subtitulo">No se pudo abrir la cartera</Texto>
      <Texto variante="suave" suave style={styles.centrado}>
        {error.message}
      </Texto>
      <Boton titulo="Reintentar" icono="refresh" onPress={reintentar} />
    </View>
  );
}

const styles = StyleSheet.create({
  centro: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.three,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  centrado: { textAlign: 'center' },
});
