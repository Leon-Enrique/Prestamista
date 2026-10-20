/**
 * Cartera: la pantalla de inicio.
 *
 * Arriba lo que te deben, en grande, con cómo va el negocio (ganado menos perdido). Debajo,
 * quién está atrasado y cuál es el próximo cobro; después lo último que pasó, y al final la
 * lista de préstamos por cobrar, lo más urgente primero. Bolivianos y dólares nunca se suman.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Aviso,
  Boton,
  BotonIcono,
  Cargando,
  CuadroIcono,
  FilaActividad,
  Fila,
  Insignia,
  Monto,
  Pantalla,
  Seccion,
  Tarjeta,
  TarjetaDestacada,
  Texto,
  Vacio,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  actividadReciente,
  carteraActiva,
  cobradoEnPeriodo,
  perdidas,
  totalesDeCartera,
  type ResumenPrestamo,
} from '@/datos/consultas';
import {
  codigoPaisDe,
  diasSinRespaldoParaAvisarDe,
  leerConfiguracion,
} from '@/datos/repositorios/config';
import { diasSinRespaldo } from '@/datos/respaldo';
import { aNumeroDeWhatsApp, mensajeDeRecordatorio } from '@/dominio/mensajes';
import { ETIQUETA_MODALIDAD } from '@/dominio/tipos';
import { enviarPorWhatsApp } from '@/nucleo/compartir';
import {
  cero,
  esNegativo,
  esPositivo,
  formatear,
  restar,
  sumar,
  type Moneda,
} from '@/nucleo/dinero';
import { armarDia, formatearDiaCorto, hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';

function saludo(): string {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function PantallaCartera() {
  const tema = useTheme();
  const { refrescar } = useBase();
  const dia = hoy();
  // Sin barra de título: el saludo arranca debajo de la barra de estado.
  const { top } = useSafeAreaInsets();

  const cartera = useConsulta((db) => carteraActiva(db, dia), [dia]);
  const totales = useConsulta((db) => totalesDeCartera(db, dia), [dia]);
  // Ganancia de siempre: todo el interés y la penalización cobrados, sin pagos anulados.
  const ganancia = useConsulta((db) => cobradoEnPeriodo(db, armarDia(2000, 1, 1), dia), [dia]);
  const perdido = useConsulta((db) => perdidas(db), []);
  const actividad = useConsulta((db) => actividadReciente(db, 5), []);
  const avisos = useConsulta(async (db) => {
    const configuracion = await leerConfiguracion(db);
    return {
      dias: diasSinRespaldo(configuracion, dia),
      limite: diasSinRespaldoParaAvisarDe(configuracion),
      codigoPais: codigoPaisDe(configuracion),
    };
  }, [dia]);

  // Al volver a esta pestaña después de cobrar, los números tienen que estar actualizados.
  useFocusEffect(useCallback(() => refrescar(), [refrescar]));

  if (cartera.cargando && cartera.datos === null) {
    return (
      <Pantalla>
        <Cargando />
      </Pantalla>
    );
  }

  const prestamos = cartera.datos ?? [];
  const vencidos = prestamos.filter((p) => esPositivo(p.vencido));
  const alDia = prestamos.filter((p) => !esPositivo(p.vencido));
  const codigoPais = avisos.datos?.codigoPais ?? '591';

  // Una tarjeta principal por moneda: la que tenga préstamos en la calle o movimiento.
  const monedas: Moneda[] = [
    ...new Set<Moneda>([
      ...(totales.datos ?? []).map((t) => t.moneda),
      ...(ganancia.datos ?? []).map((g) => g.moneda),
      ...(perdido.datos ?? []).map((p) => p.moneda),
    ]),
  ];
  const resumenes = monedas.map((moneda) => {
    const total = (totales.datos ?? []).find((t) => t.moneda === moneda);
    const g = (ganancia.datos ?? []).find((fila) => fila.moneda === moneda);
    const ganado = g ? sumar(g.interes, g.penalizacion) : cero(moneda);
    const perdidoMoneda =
      (perdido.datos ?? []).find((fila) => fila.moneda === moneda)?.perdido ?? cero(moneda);
    return {
      moneda,
      teDeben: total?.saldo ?? cero(moneda),
      vencido: total?.vencido ?? cero(moneda),
      cantidad: total?.prestamos ?? 0,
      ganado,
      perdido: perdidoMoneda,
      resultado: restar(ganado, perdidoMoneda),
    };
  });

  // El próximo cobro que todavía no venció.
  const proximo =
    [...alDia]
      .filter((p) => p.proximoVencimiento !== null)
      .sort((a, b) => (a.proximoVencimiento! < b.proximoVencimiento! ? -1 : 1))[0] ?? null;

  const movimientos = actividad.datos ?? [];
  const sinNada = prestamos.length === 0 && movimientos.length === 0;

  return (
    <Pantalla style={{ paddingTop: top + Spacing.three }}>
      <Fila separado>
        <View style={styles.flex}>
          <Texto variante="titulo" style={styles.saludo}>
            {saludo()}
          </Texto>
          <Texto variante="suave" suave>
            {formatearDiaCorto(dia)}
          </Texto>
        </View>
        <View style={[styles.avatar, { borderColor: tema.primario }]}>
          <Texto variante="subtitulo" color={tema.primario}>
            P
          </Texto>
        </View>
      </Fila>

      {cartera.error || totales.error ? (
        <Aviso tono="peligro" icono="warning">
          {(cartera.error ?? totales.error)?.message}
        </Aviso>
      ) : null}

      {avisos.datos && (avisos.datos.dias === null || avisos.datos.dias >= avisos.datos.limite) ? (
        <Aviso tono="peligro" icono="cloud-offline">
          {avisos.datos.dias === null ? 'Sin respaldo' : `${avisos.datos.dias} días sin respaldo`}
        </Aviso>
      ) : null}

      {resumenes.map((r) => (
        <TarjetaDestacada key={r.moneda}>
          <Texto variante="etiqueta" color={tema.alDia}>
            Te deben{monedas.length > 1 ? ` · ${r.moneda === 'BOB' ? 'bolivianos' : 'dólares'}` : ''}
          </Texto>
          <Monto valor={r.teDeben} variante="titulo" />
          <Texto variante="suave" suave>
            {r.cantidad} {r.cantidad === 1 ? 'préstamo' : 'préstamos'} ·{' '}
            {esPositivo(r.vencido) ? `${formatear(r.vencido)} vencido` : 'nada vencido'}
          </Texto>
          <Fila separado style={styles.pieDestacada}>
            <View style={styles.flex}>
              <Texto variante="suave" color={tema.alDia}>
                Ganado {formatear(r.ganado)}
              </Texto>
              {esPositivo(r.perdido) ? (
                <Texto variante="suave" color={tema.vencido}>
                  Perdido {formatear(r.perdido)}
                </Texto>
              ) : null}
            </View>
            <Insignia
              texto={esNegativo(r.resultado) ? 'Perdiendo' : 'Ganando'}
              color={tema.primarioTexto}
              fondo={esNegativo(r.resultado) ? tema.vencido : tema.primario}
            />
          </Fila>
        </TarjetaDestacada>
      ))}

      {prestamos.length > 0 ? (
        <Tarjeta>
          <Fila>
            {vencidos.length > 0 ? (
              <CuadroIcono
                icono="alert"
                color={tema.vencido}
                etiqueta="Atrasados"
                valor={`${vencidos.length} ${vencidos.length === 1 ? 'cliente' : 'clientes'}`}
              />
            ) : (
              <CuadroIcono
                icono="checkmark"
                color={tema.alDia}
                etiqueta="Al día"
                valor={`${prestamos.length} ${prestamos.length === 1 ? 'préstamo' : 'préstamos'}`}
              />
            )}
            <View style={[styles.divisor, { backgroundColor: tema.borde }]} />
            <CuadroIcono
              icono="calendar"
              color={tema.primario}
              etiqueta="Próximo cobro"
              valor={
                proximo
                  ? `${formatearDiaCorto(proximo.proximoVencimiento!)} · ${proximo.cliente}`
                  : 'Nada pendiente'
              }
              onPress={
                proximo
                  ? () =>
                      router.push({ pathname: '/prestamo/[id]', params: { id: proximo.prestamoId } })
                  : undefined
              }
            />
          </Fila>
        </Tarjeta>
      ) : null}

      <Boton
        titulo="Nuevo préstamo"
        icono="add-circle"
        onPress={() => router.push('/prestamo/nuevo')}
      />

      {sinNada ? <Vacio titulo="Todavía no prestaste nada" /> : null}

      {movimientos.length > 0 ? (
        <Seccion titulo="Actividad reciente">
          <Tarjeta>
            {movimientos.map((m) => (
              <FilaActividad
                key={m.clave}
                icono={m.tipo === 'cobro' ? 'arrow-down' : 'arrow-up'}
                color={m.tipo === 'cobro' ? tema.alDia : tema.textSecondary}
                titulo={`${m.tipo === 'cobro' ? 'Cobro' : 'Préstamo'} · ${m.clienteNombre}`}
                detalle={formatearDiaCorto(m.fecha)}
                monto={m.monto}
                entra={m.tipo === 'cobro'}
              />
            ))}
          </Tarjeta>
        </Seccion>
      ) : null}

      {vencidos.length > 0 ? (
        <Seccion titulo={`Atrasados (${vencidos.length})`}>
          {vencidos.map((prestamo) => (
            <FilaPrestamo key={prestamo.prestamoId} prestamo={prestamo} codigoPais={codigoPais} />
          ))}
        </Seccion>
      ) : null}

      {alDia.length > 0 ? (
        <Seccion titulo={`Al día (${alDia.length})`}>
          {alDia.map((prestamo) => (
            <FilaPrestamo key={prestamo.prestamoId} prestamo={prestamo} codigoPais={codigoPais} />
          ))}
        </Seccion>
      ) : null}
    </Pantalla>
  );
}

function FilaPrestamo({
  prestamo,
  codigoPais,
}: {
  prestamo: ResumenPrestamo;
  codigoPais: string;
}) {
  const tema = useTheme();
  const atrasado = esPositivo(prestamo.vencido);

  /** Abre WhatsApp con el recordatorio escrito. Mandarlo lo decide el usuario. */
  const recordar = () => {
    void enviarPorWhatsApp(
      aNumeroDeWhatsApp(prestamo.telefono, codigoPais),
      mensajeDeRecordatorio({
        cliente: prestamo.cliente,
        vencido: prestamo.vencido,
        total: prestamo.saldo,
        vencimiento: prestamo.proximoVencimiento,
        diasDeAtraso: prestamo.diasDeAtraso,
      }),
    );
  };

  return (
    <Tarjeta
      acento={atrasado ? tema.vencido : tema.alDia}
      onPress={() =>
        router.push({ pathname: '/prestamo/[id]', params: { id: prestamo.prestamoId } })
      }>
      <Fila separado>
        <View style={styles.flex}>
          <Texto variante="subtitulo" numberOfLines={1}>
            {prestamo.cliente}
          </Texto>
        </View>
        <Monto valor={prestamo.saldo} variante="subtitulo" />
      </Fila>

      <Fila separado>
        <Texto variante="suave" suave numberOfLines={1} style={styles.flex}>
          {prestamo.proximoVencimiento
            ? `Próximo pago ${formatearDiaCorto(prestamo.proximoVencimiento)}`
            : ETIQUETA_MODALIDAD[prestamo.modalidad]}
        </Texto>
        {atrasado ? (
          <Insignia
            texto={`${prestamo.diasDeAtraso} ${prestamo.diasDeAtraso === 1 ? 'día' : 'días'}`}
            color={tema.vencido}
            fondo={tema.vencidoSuave}
          />
        ) : null}
      </Fila>

      {atrasado ? (
        <Fila separado>
          <Texto variante="suave" color={tema.vencido} style={styles.flex}>
            {formatear(prestamo.vencido)} vencido
          </Texto>
          <BotonIcono
            icono="logo-whatsapp"
            etiqueta={`Recordarle a ${prestamo.cliente} por WhatsApp`}
            color={tema.alDia}
            onPress={recordar}
          />
        </Fila>
      ) : null}
    </Tarjeta>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, paddingRight: Spacing.two },
  saludo: { fontWeight: '500' },
  avatar: {
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: 2,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  pieDestacada: { marginTop: Spacing.two },
  divisor: { alignSelf: 'stretch', width: StyleSheet.hairlineWidth },
});
