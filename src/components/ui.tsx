/**
 * Componentes de interfaz compartidos.
 *
 * La app se usa de pie, con el cliente enfrente y a veces con poca luz: los montos van
 * grandes y alineados, los botones se tocan sin apuntar, y el estado de una deuda se
 * distingue por color **y** por texto, nunca solo por color.
 *
 * Nada de lógica de negocio acá: estos componentes muestran lo que reciben.
 */

import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatear, type Dinero } from '@/nucleo/dinero';

// --- Texto ----------------------------------------------------------------------------

type VarianteTexto = 'titulo' | 'subtitulo' | 'cuerpo' | 'suave' | 'etiqueta';

const ESTILO_TEXTO: Record<VarianteTexto, TextStyle> = {
  titulo: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitulo: { fontSize: 18, fontWeight: '600' },
  cuerpo: { fontSize: 16 },
  suave: { fontSize: 14 },
  etiqueta: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
};

export function Texto({
  children,
  variante = 'cuerpo',
  suave,
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variante?: VarianteTexto;
  suave?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const tema = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        ESTILO_TEXTO[variante],
        { color: color ?? (suave ? tema.textSecondary : tema.text) },
        style,
      ]}>
      {children}
    </Text>
  );
}

/** Un monto, siempre con su moneda y tabular para que las columnas queden alineadas. */
export function Monto({
  valor,
  variante = 'cuerpo',
  color,
  sinSimbolo,
}: {
  valor: Dinero;
  variante?: VarianteTexto;
  color?: string;
  sinSimbolo?: boolean;
}) {
  return (
    <Texto variante={variante} color={color} style={styles.tabular}>
      {formatear(valor, { sinSimbolo })}
    </Texto>
  );
}

// --- Contenedores ---------------------------------------------------------------------

export function Pantalla({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const tema = useTheme();
  const contenido = (
    <View style={[styles.pantallaInterior, style]}>{children}</View>
  );

  if (!scroll) {
    return <View style={[styles.pantalla, { backgroundColor: tema.background }]}>{contenido}</View>;
  }
  return (
    <ScrollView
      style={[styles.pantalla, { backgroundColor: tema.background }]}
      contentContainerStyle={styles.scrollContenido}
      keyboardShouldPersistTaps="handled">
      {contenido}
    </ScrollView>
  );
}

export function Tarjeta({
  children,
  onPress,
  style,
  acento,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Franja de color a la izquierda, para marcar urgencia sin depender solo del color. */
  acento?: string;
}) {
  const tema = useTheme();
  const base: ViewStyle = {
    backgroundColor: tema.backgroundElement,
    borderColor: tema.borde,
    borderLeftColor: acento ?? tema.borde,
    borderLeftWidth: acento ? 4 : StyleSheet.hairlineWidth,
  };

  if (!onPress) {
    return <View style={[styles.tarjeta, base, style]}>{children}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tarjeta,
        base,
        pressed && { backgroundColor: tema.backgroundSelected },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

export function Seccion({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <View style={styles.seccion}>
      {titulo ? (
        <Texto variante="etiqueta" suave style={styles.tituloSeccion}>
          {titulo}
        </Texto>
      ) : null}
      {children}
    </View>
  );
}

export function Fila({
  children,
  style,
  separado,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  separado?: boolean;
}) {
  return (
    <View style={[styles.fila, separado && styles.filaSeparada, style]}>{children}</View>
  );
}

/** Dato con su etiqueta, para las fichas de detalle. */
export function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <Fila separado style={styles.dato}>
      <Texto suave>{etiqueta}</Texto>
      <View style={styles.datoValor}>{children}</View>
    </Fila>
  );
}

// --- Botones --------------------------------------------------------------------------

export function Boton({
  titulo,
  onPress,
  variante = 'primario',
  icono,
  cargando,
  deshabilitado,
  style,
}: {
  titulo: string;
  onPress: () => void;
  variante?: 'primario' | 'secundario' | 'peligro';
  icono?: keyof typeof Ionicons.glyphMap;
  cargando?: boolean;
  deshabilitado?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const tema = useTheme();
  const inactivo = deshabilitado || cargando;

  const fondo =
    variante === 'primario' ? tema.primario : variante === 'peligro' ? tema.vencido : 'transparent';
  const colorTexto =
    variante === 'primario'
      ? tema.primarioTexto
      : variante === 'peligro'
        ? tema.primarioTexto
        : tema.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactivo}
      style={({ pressed }) => [
        styles.boton,
        {
          backgroundColor: variante === 'peligro' ? tema.vencido : fondo,
          borderColor: variante === 'secundario' ? tema.borde : 'transparent',
          borderWidth: variante === 'secundario' ? StyleSheet.hairlineWidth : 0,
          opacity: inactivo ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      {cargando ? (
        <ActivityIndicator color={colorTexto} />
      ) : (
        <>
          {icono ? <Ionicons name={icono} size={18} color={colorTexto} /> : null}
          <Text style={[styles.textoBoton, { color: colorTexto }]}>{titulo}</Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * Botón chico de un solo icono, para acciones secundarias dentro de una tarjeta de lista.
 * Mantiene 44 px de área táctil aunque el icono sea chico: se usa de pie y con apuro.
 */
export function BotonIcono({
  icono,
  onPress,
  color,
  etiqueta,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  color?: string;
  /** Para lectores de pantalla: un icono solo no dice qué hace. */
  etiqueta: string;
}) {
  const tema = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      hitSlop={8}
      style={({ pressed }) => [
        styles.botonIcono,
        {
          backgroundColor: pressed ? tema.backgroundSelected : 'transparent',
          borderColor: tema.borde,
        },
      ]}>
      <Ionicons name={icono} size={20} color={color ?? tema.text} />
    </Pressable>
  );
}

// --- Entradas -------------------------------------------------------------------------

export function Campo({
  etiqueta,
  valor,
  onChange,
  placeholder,
  ayuda,
  error,
  teclado = 'default',
  autoFocus,
  multilinea,
}: {
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  ayuda?: string;
  error?: string | null;
  teclado?: 'default' | 'numeric' | 'decimal-pad' | 'phone-pad';
  autoFocus?: boolean;
  multilinea?: boolean;
}) {
  const tema = useTheme();
  return (
    <View style={styles.campo}>
      <Texto variante="etiqueta" suave>
        {etiqueta}
      </Texto>
      <TextInput
        value={valor}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={tema.textSecondary}
        keyboardType={teclado}
        autoFocus={autoFocus}
        multiline={multilinea}
        style={[
          styles.entrada,
          multilinea && styles.entradaMultilinea,
          {
            color: tema.text,
            backgroundColor: tema.backgroundElement,
            borderColor: error ? tema.vencido : tema.borde,
          },
        ]}
      />
      {error ? (
        <Texto variante="suave" color={tema.vencido}>
          {error}
        </Texto>
      ) : ayuda ? (
        <Texto variante="suave" suave>
          {ayuda}
        </Texto>
      ) : null}
    </View>
  );
}

/** Selector de una opción entre pocas. Más rápido de tocar que un desplegable. */
export function Opciones<T extends string>({
  etiqueta,
  valor,
  opciones,
  onChange,
  ayuda,
}: {
  etiqueta: string;
  valor: T;
  opciones: readonly { valor: T; titulo: string }[];
  onChange: (valor: T) => void;
  ayuda?: string;
}) {
  const tema = useTheme();
  return (
    <View style={styles.campo}>
      <Texto variante="etiqueta" suave>
        {etiqueta}
      </Texto>
      <View style={styles.opciones}>
        {opciones.map((opcion) => {
          const elegida = opcion.valor === valor;
          return (
            <Pressable
              key={opcion.valor}
              onPress={() => onChange(opcion.valor)}
              style={[
                styles.opcion,
                {
                  backgroundColor: elegida ? tema.primario : tema.backgroundElement,
                  borderColor: elegida ? tema.primario : tema.borde,
                },
              ]}>
              <Text
                style={[
                  styles.textoOpcion,
                  { color: elegida ? tema.primarioTexto : tema.text },
                ]}>
                {opcion.titulo}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {ayuda ? (
        <Texto variante="suave" suave>
          {ayuda}
        </Texto>
      ) : null}
    </View>
  );
}

// --- Piezas de la pantalla de inicio --------------------------------------------------

/**
 * Pantalla de una pestaña: sin barra de título del sistema, con un encabezado grande propio
 * que arranca debajo de la barra de estado.
 */
export function PantallaPrincipal({
  titulo,
  subtitulo,
  derecha,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  derecha?: ReactNode;
  children: ReactNode;
}) {
  const { top } = useSafeAreaInsets();
  return (
    <Pantalla style={{ paddingTop: top + Spacing.three }}>
      <View style={[styles.fila, styles.filaSeparada]}>
        <View style={styles.cuadroTexto}>
          <Texto variante="titulo" style={styles.tituloPrincipal}>
            {titulo}
          </Texto>
          {subtitulo ? (
            <Texto variante="suave" suave>
              {subtitulo}
            </Texto>
          ) : null}
        </View>
        {derecha}
      </View>
      {children}
    </Pantalla>
  );
}

/** La inicial de un nombre en un círculo con borde dorado. */
export function Avatar({ nombre, grande }: { nombre: string; grande?: boolean }) {
  const tema = useTheme();
  const lado = grande ? 52 : 42;
  return (
    <View
      style={[
        styles.avatar,
        { borderColor: tema.primario, width: lado, height: lado, borderRadius: lado / 2 },
      ]}>
      <Texto variante="subtitulo" color={tema.primario}>
        {nombre.trim().charAt(0).toUpperCase() || '?'}
      </Texto>
    </View>
  );
}

/** Botón redondo dorado con un ícono, para la acción principal del encabezado. */
export function BotonRedondo({
  icono,
  etiqueta,
  onPress,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  etiqueta: string;
  onPress: () => void;
}) {
  const tema = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      hitSlop={8}
      style={({ pressed }) => [
        styles.botonRedondo,
        { backgroundColor: tema.primario, opacity: pressed ? 0.85 : 1 },
      ]}>
      <Ionicons name={icono} size={26} color={tema.primarioTexto} />
    </Pressable>
  );
}

/** Tarjeta principal: borde dorado y un leve brillo, para la cifra más importante. */
export function TarjetaDestacada({ children }: { children: ReactNode }) {
  const tema = useTheme();
  return (
    <View
      style={[
        styles.destacada,
        {
          backgroundColor: tema.backgroundElement,
          borderColor: tema.primario,
          shadowColor: tema.primario,
        },
      ]}>
      {children}
    </View>
  );
}

/** Ícono en un círculo de color, con una etiqueta y un valor al lado. */
export function CuadroIcono({
  icono,
  color,
  etiqueta,
  valor,
  onPress,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  color: string;
  etiqueta: string;
  valor: string;
  onPress?: () => void;
}) {
  const tema = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.cuadroIcono}>
      <View style={[styles.circuloIcono, { backgroundColor: color }]}>
        <Ionicons name={icono} size={22} color={tema.primarioTexto} />
      </View>
      <View style={styles.cuadroTexto}>
        <Texto variante="suave" suave numberOfLines={1}>
          {etiqueta}
        </Texto>
        <Texto numberOfLines={2} style={styles.cuadroValor}>
          {valor}
        </Texto>
      </View>
    </Pressable>
  );
}

/** Una línea de actividad: ícono enmarcado, título, fecha y monto con signo. */
export function FilaActividad({
  icono,
  color,
  titulo,
  detalle,
  monto,
  entra,
  apagado,
  onPress,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  color: string;
  titulo: string;
  detalle: string;
  monto: Dinero;
  /** Plata que entra: va en verde y con "+". */
  entra: boolean;
  /** Para lo que no movió plata, como un cobro anulado: gris y sin signo. */
  apagado?: boolean;
  onPress?: () => void;
}) {
  const tema = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.filaActividad, pressed && { opacity: 0.7 }]}>
      <View style={[styles.marcoIcono, { borderColor: color }]}>
        <Ionicons name={icono} size={22} color={color} />
      </View>
      <View style={styles.cuadroTexto}>
        <Texto numberOfLines={1} style={styles.cuadroValor}>
          {titulo}
        </Texto>
        <Texto variante="suave" suave numberOfLines={1}>
          {detalle}
        </Texto>
      </View>
      <Texto
        variante="subtitulo"
        color={apagado ? tema.textSecondary : entra ? tema.alDia : tema.text}
        style={[styles.tabular, apagado && styles.tachado]}>
        {apagado ? '' : entra ? '+' : '−'}
        {formatear(monto)}
      </Texto>
    </Pressable>
  );
}

/** Flechas para pasar de página en una lista larga: "‹  2 de 5  ›". */
export function Paginador({
  pagina,
  totalPaginas,
  onCambiar,
}: {
  /** Empieza en 0. */
  pagina: number;
  totalPaginas: number;
  onCambiar: (pagina: number) => void;
}) {
  const tema = useTheme();
  if (totalPaginas <= 1) return null;
  const hayAnterior = pagina > 0;
  const haySiguiente = pagina < totalPaginas - 1;
  return (
    <View style={[styles.fila, styles.paginador]}>
      <BotonIcono
        icono="chevron-back"
        etiqueta="Página anterior"
        color={hayAnterior ? tema.primarioTinta : tema.borde}
        onPress={() => hayAnterior && onCambiar(pagina - 1)}
      />
      <Texto suave style={styles.tabular}>
        {pagina + 1} de {totalPaginas}
      </Texto>
      <BotonIcono
        icono="chevron-forward"
        etiqueta="Página siguiente"
        color={haySiguiente ? tema.primarioTinta : tema.borde}
        onPress={() => haySiguiente && onCambiar(pagina + 1)}
      />
    </View>
  );
}

// --- Señales --------------------------------------------------------------------------

export function Insignia({ texto, color, fondo }: { texto: string; color: string; fondo: string }) {
  return (
    <View style={[styles.insignia, { backgroundColor: fondo }]}>
      <Text style={[styles.textoInsignia, { color }]}>{texto}</Text>
    </View>
  );
}

export function Aviso({
  children,
  tono = 'aviso',
  icono = 'alert-circle',
}: {
  children: ReactNode;
  tono?: 'aviso' | 'peligro' | 'bien';
  icono?: keyof typeof Ionicons.glyphMap;
}) {
  const tema = useTheme();
  const color = tono === 'peligro' ? tema.vencido : tono === 'bien' ? tema.alDia : tema.aviso;
  const fondo =
    tono === 'peligro' ? tema.vencidoSuave : tono === 'bien' ? tema.alDiaSuave : tema.avisoSuave;

  return (
    <View style={[styles.aviso, { backgroundColor: fondo }]}>
      <Ionicons name={icono} size={18} color={color} />
      <View style={styles.avisoTexto}>
        <Texto variante="suave" color={color}>
          {children}
        </Texto>
      </View>
    </View>
  );
}

export function Vacio({ titulo, detalle }: { titulo: string; detalle?: string }) {
  const tema = useTheme();
  return (
    <View style={styles.vacio}>
      <Ionicons name="file-tray-outline" size={32} color={tema.textSecondary} />
      <Texto variante="subtitulo" suave>
        {titulo}
      </Texto>
      {detalle ? (
        <Texto variante="suave" suave style={styles.vacioDetalle}>
          {detalle}
        </Texto>
      ) : null}
    </View>
  );
}

export function Cargando({ texto }: { texto?: string }) {
  const tema = useTheme();
  return (
    <View style={styles.cargando}>
      <ActivityIndicator color={tema.primarioTinta} />
      {texto ? (
        <Texto variante="suave" suave>
          {texto}
        </Texto>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
  pantalla: { flex: 1 },
  pantallaInterior: { gap: Spacing.three, padding: Spacing.three },
  scrollContenido: { paddingBottom: Spacing.six },
  tarjeta: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  seccion: { gap: Spacing.two },
  tituloSeccion: { marginBottom: Spacing.half },
  fila: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  filaSeparada: { justifyContent: 'space-between' },
  dato: { minHeight: 28 },
  datoValor: { alignItems: 'flex-end', flexShrink: 1 },
  boton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: Spacing.four,
  },
  textoBoton: { fontSize: 17, fontWeight: '700' },
  botonIcono: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  campo: { gap: Spacing.one },
  entrada: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 17,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  entradaMultilinea: { minHeight: 90, textAlignVertical: 'top' },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  opcion: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  textoOpcion: { fontSize: 15, fontWeight: '500' },
  insignia: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 4 },
  textoInsignia: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  aviso: {
    alignItems: 'flex-start',
    borderRadius: 12,
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  avisoTexto: { flex: 1 },
  vacio: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  vacioDetalle: { textAlign: 'center' },
  cargando: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  tituloPrincipal: { fontWeight: '600' },
  tachado: { textDecorationLine: 'line-through' },
  paginador: { gap: Spacing.four, justifyContent: 'center', paddingTop: Spacing.two },
  avatar: { alignItems: 'center', borderWidth: 2, justifyContent: 'center' },
  botonRedondo: {
    alignItems: 'center',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  destacada: {
    borderRadius: 24,
    borderWidth: 1,
    elevation: 8,
    gap: Spacing.two,
    padding: Spacing.four,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  cuadroIcono: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: Spacing.two },
  circuloIcono: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  cuadroTexto: { flex: 1, gap: 2 },
  cuadroValor: { fontWeight: '600' },
  filaActividad: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  marcoIcono: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
});
