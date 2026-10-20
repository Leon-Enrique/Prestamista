/**
 * Pantalla de bloqueo.
 *
 * Si no hay PIN definido, deja pasar: no se le va a exigir uno a alguien que recién instaló
 * la app. Ajustes ofrece ponerlo, y la cartera avisa mientras no esté.
 *
 * La huella se ofrece sola al abrir, pero **el PIN siempre sigue disponible**: si el lector
 * deja de andar, nadie puede quedar encerrado afuera de su propia cartera.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Boton, Cargando, Texto } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  autenticarConBiometria,
  hayBiometria,
  hayPinDefinido,
  LARGO_MINIMO_PIN,
  verificarPin,
} from '@/datos/pin';
import { useTheme } from '@/hooks/use-theme';

const LARGO_MAXIMO = 10;

type Fase = 'comprobando' | 'bloqueado' | 'abierto';

export function Bloqueo({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<Fase>('comprobando');
  const [conBiometria, setConBiometria] = useState(false);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      const [tienePin, tieneBiometria] = await Promise.all([hayPinDefinido(), hayBiometria()]);
      if (cancelado) return;

      setConBiometria(tieneBiometria);
      if (!tienePin) {
        setFase('abierto');
        return;
      }
      setFase('bloqueado');

      if (tieneBiometria && (await autenticarConBiometria()) && !cancelado) {
        setFase('abierto');
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const abrir = useCallback(() => setFase('abierto'), []);

  if (fase === 'comprobando') return <PantallaCentrada />;
  if (fase === 'bloqueado') {
    return <TecladoPin conBiometria={conBiometria} alDesbloquear={abrir} />;
  }
  return <>{children}</>;
}

function PantallaCentrada() {
  const tema = useTheme();
  return (
    <View style={[styles.centro, { backgroundColor: tema.background }]}>
      <Cargando />
    </View>
  );
}

function TecladoPin({
  conBiometria,
  alDesbloquear,
}: {
  conBiometria: boolean;
  alDesbloquear: () => void;
}) {
  const tema = useTheme();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const agregar = async (digito: string) => {
    if (pin.length >= LARGO_MAXIMO) return;
    const siguiente = pin + digito;
    setPin(siguiente);
    setError(null);

    if (siguiente.length >= LARGO_MINIMO_PIN && (await verificarPin(siguiente))) {
      alDesbloquear();
      return;
    }
    if (siguiente.length >= LARGO_MAXIMO) {
      setPin('');
      setError('PIN incorrecto.');
    }
  };

  const borrar = () => {
    setPin((anterior) => anterior.slice(0, -1));
    setError(null);
  };

  return (
    <View style={[styles.centro, { backgroundColor: tema.background }]}>
      <View style={styles.encabezado}>
        <Ionicons name="lock-closed" size={30} color={tema.textSecondary} />
        <Texto variante="subtitulo">Ingresá tu PIN</Texto>
        {error ? (
          <Texto variante="suave" color={tema.vencido}>
            {error}
          </Texto>
        ) : (
          <Texto variante="suave" suave>
            Para ver tu cartera
          </Texto>
        )}
      </View>

      <View style={styles.puntos}>
        {Array.from({ length: Math.max(LARGO_MINIMO_PIN, pin.length) }).map((_, indice) => (
          <View
            key={indice}
            style={[
              styles.punto,
              {
                backgroundColor: indice < pin.length ? tema.primario : 'transparent',
                borderColor: tema.borde,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.teclado}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digito) => (
          <Tecla key={digito} etiqueta={digito} onPress={() => void agregar(digito)} />
        ))}
        <View style={styles.tecla} />
        <Tecla etiqueta="0" onPress={() => void agregar('0')} />
        <Tecla icono="backspace-outline" onPress={borrar} />
      </View>

      {conBiometria ? (
        <Boton
          titulo="Usar huella"
          icono="finger-print"
          variante="secundario"
          onPress={() => {
            void autenticarConBiometria().then((logrado) => {
              if (logrado) alDesbloquear();
            });
          }}
          style={styles.botonHuella}
        />
      ) : null}
    </View>
  );
}

function Tecla({
  etiqueta,
  icono,
  onPress,
}: {
  etiqueta?: string;
  icono?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const tema = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tecla,
        {
          backgroundColor: pressed ? tema.backgroundSelected : tema.backgroundElement,
          borderColor: tema.borde,
        },
      ]}>
      {icono ? (
        <Ionicons name={icono} size={24} color={tema.text} />
      ) : (
        <Texto variante="titulo">{etiqueta}</Texto>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centro: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.four,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  encabezado: { alignItems: 'center', gap: Spacing.two },
  puntos: { flexDirection: 'row', gap: Spacing.two, minHeight: 16 },
  punto: { borderRadius: 7, borderWidth: 1, height: 14, width: 14 },
  teclado: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    justifyContent: 'center',
    maxWidth: 260,
  },
  tecla: {
    alignItems: 'center',
    borderRadius: 40,
    borderWidth: StyleSheet.hairlineWidth,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  botonHuella: { minWidth: 200 },
});
