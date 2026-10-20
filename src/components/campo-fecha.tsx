/**
 * Campo de fecha con calendario: se toca, se abre el mes, se elige el día.
 *
 * Propio y sin dependencias nativas, para que funcione igual en Expo Go y en el APK y use los
 * colores de la app. Trabaja con `Dia` (día de calendario), nunca con instantes.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Boton, Texto } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { armarDia, diasEnMes, formatearDiaCorto, type Dia } from '@/nucleo/fechas';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function CampoFecha({
  etiqueta,
  valor,
  onChange,
  maximo,
  hoy,
}: {
  etiqueta: string;
  valor: Dia;
  onChange: (dia: Dia) => void;
  /** Último día elegible: por ejemplo hoy, para que no se elija una fecha futura. */
  maximo?: Dia;
  hoy: Dia;
}) {
  const tema = useTheme();
  const [abierto, setAbierto] = useState(false);
  const [anio, setAnio] = useState(Number(valor.slice(0, 4)));
  const [mes, setMes] = useState(Number(valor.slice(5, 7)));

  const abrir = () => {
    setAnio(Number(valor.slice(0, 4)));
    setMes(Number(valor.slice(5, 7)));
    setAbierto(true);
  };

  const mover = (delta: number) => {
    const total = anio * 12 + (mes - 1) + delta;
    setAnio(Math.floor(total / 12));
    setMes((total % 12) + 1);
  };

  const elegir = (dia: Dia) => {
    onChange(dia);
    setAbierto(false);
  };

  // Semana que empieza en lunes: getUTCDay da 0 para el domingo.
  const primerDia = (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7;
  const celdas: (Dia | null)[] = [
    ...Array<null>(primerDia).fill(null),
    ...Array.from({ length: diasEnMes(anio, mes) }, (_, i) => armarDia(anio, mes, i + 1)),
  ];
  // No se avanza a un mes que queda entero después del máximo.
  const sinMesSiguiente =
    maximo !== undefined && armarDia(anio, mes, diasEnMes(anio, mes)) >= maximo;

  return (
    <View style={styles.campo}>
      <Texto variante="etiqueta" suave>
        {etiqueta}
      </Texto>
      <Pressable
        onPress={abrir}
        accessibilityRole="button"
        style={[
          styles.entrada,
          { backgroundColor: tema.backgroundElement, borderColor: tema.borde },
        ]}>
        <Text style={[styles.textoEntrada, { color: tema.text }]}>
          {valor === hoy ? `Hoy · ${formatearDiaCorto(valor)}` : formatearDiaCorto(valor)}
        </Text>
        <Ionicons name="calendar" size={20} color={tema.primarioTinta} />
      </Pressable>

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={styles.fondo} onPress={() => setAbierto(false)}>
          <Pressable
            style={[styles.calendario, { backgroundColor: tema.background, borderColor: tema.primario }]}
            onPress={() => undefined}>
            <View style={styles.cabecera}>
              <Pressable onPress={() => mover(-1)} hitSlop={12} style={styles.flecha}>
                <Ionicons name="chevron-back" size={24} color={tema.text} />
              </Pressable>
              <Texto variante="subtitulo">
                {MESES[mes - 1]} {anio}
              </Texto>
              <Pressable
                onPress={() => mover(1)}
                hitSlop={12}
                disabled={sinMesSiguiente}
                style={styles.flecha}>
                <Ionicons
                  name="chevron-forward"
                  size={24}
                  color={sinMesSiguiente ? tema.borde : tema.text}
                />
              </Pressable>
            </View>

            <View style={styles.grilla}>
              {DIAS_SEMANA.map((d, i) => (
                <View key={`s${i}`} style={styles.celda}>
                  <Texto variante="suave" suave>
                    {d}
                  </Texto>
                </View>
              ))}
              {celdas.map((dia, i) => {
                if (dia === null) return <View key={`v${i}`} style={styles.celda} />;
                const elegido = dia === valor;
                const fuera = maximo !== undefined && dia > maximo;
                return (
                  <Pressable
                    key={dia}
                    disabled={fuera}
                    onPress={() => elegir(dia)}
                    style={styles.celda}>
                    <View
                      style={[
                        styles.numero,
                        elegido && { backgroundColor: tema.primario },
                        !elegido && dia === hoy && { borderColor: tema.primario, borderWidth: 1 },
                      ]}>
                      <Text
                        style={[
                          styles.textoNumero,
                          {
                            color: elegido
                              ? tema.primarioTexto
                              : fuera
                                ? tema.borde
                                : tema.text,
                          },
                        ]}>
                        {Number(dia.slice(8, 10))}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.pie}>
              <Boton titulo="Hoy" variante="secundario" onPress={() => elegir(hoy)} style={styles.flex} />
              <Boton titulo="Cerrar" variante="secundario" onPress={() => setAbierto(false)} style={styles.flex} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  campo: { gap: Spacing.one },
  entrada: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Spacing.three,
  },
  textoEntrada: { fontSize: 17 },
  fondo: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.three,
  },
  calendario: {
    borderRadius: 24,
    borderWidth: 1,
    gap: Spacing.two,
    maxWidth: 420,
    padding: Spacing.three,
    width: '100%',
  },
  cabecera: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  flecha: { padding: Spacing.one },
  grilla: { flexDirection: 'row', flexWrap: 'wrap' },
  celda: { alignItems: 'center', aspectRatio: 1, justifyContent: 'center', width: `${100 / 7}%` },
  numero: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  textoNumero: { fontSize: 16, fontWeight: '500' },
  pie: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
});
