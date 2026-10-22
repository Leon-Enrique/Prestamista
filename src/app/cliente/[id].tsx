/**
 * Ficha del cliente: cuánto le prestaste, cuánto te pagó, cuánto ganaste y cuánto debe;
 * sus préstamos, y abajo el historial de cada pago con su fecha.
 *
 * "Le prestaste" cuenta solo la plata que salió de tu mano: un préstamo que nace de
 * refinanciar otro repite la deuda vieja y no se suma dos veces.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { textoReparto } from '@/components/desglose-de-cobro';
import {
  Avatar,
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
import {
  cobrosDetallados,
  comportamientoDeCliente,
  perdidas,
  prestamosDeCliente,
} from '@/datos/consultas';
import { enTransaccion } from '@/datos/base';
import { obtenerCliente } from '@/datos/repositorios/clientes';
import { ETIQUETA_MODALIDAD } from '@/dominio/tipos';
import { cero, esPositivo, formatear, sumar } from '@/nucleo/dinero';
import { ahora, formatearDiaCorto, hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';
import { eliminarCliente } from '@/servicios/eliminar-cliente';

export default function PantallaCliente() {
  const tema = useTheme();
  const { db, refrescar } = useBase();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clienteId = Number(id);
  const dia = hoy();

  const ficha = useConsulta(
    async (db) => ({
      cliente: await obtenerCliente(db, clienteId),
      prestamos: await prestamosDeCliente(db, clienteId, dia),
      comportamiento: await comportamientoDeCliente(db, clienteId),
      cobros: await cobrosDetallados(db, { clienteId }),
      perdidas: await perdidas(db, clienteId),
    }),
    [clienteId, dia],
  );

  useFocusEffect(useCallback(() => refrescar(), [refrescar]));

  if (ficha.cargando && ficha.datos === null) {
    return (
      <Pantalla>
        <Cargando />
      </Pantalla>
    );
  }

  const cliente = ficha.datos?.cliente;
  if (!cliente) {
    return (
      <Pantalla>
        <Vacio titulo="No se encontró el cliente" />
      </Pantalla>
    );
  }

  const prestamos = ficha.datos?.prestamos ?? [];
  const cobros = ficha.datos?.cobros ?? [];
  const contacto = [cliente.telefono, cliente.ci ? `CI ${cliente.ci}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pantalla>
      <Fila>
        <Avatar nombre={cliente.nombre} grande />
        <View style={styles.flex}>
          <Texto variante="titulo" numberOfLines={2}>
            {cliente.nombre}
          </Texto>
          {contacto ? (
            <Texto variante="suave" suave>
              {contacto}
            </Texto>
          ) : null}
          {cliente.direccion ? (
            <Texto variante="suave" suave>
              {cliente.direccion}
            </Texto>
          ) : null}
        </View>
        <BotonIcono
          icono="create-outline"
          etiqueta="Editar cliente"
          onPress={() => router.push({ pathname: '/cliente/editar', params: { id: clienteId } })}
        />
      </Fila>

      {(ficha.datos?.comportamiento ?? []).map((resumen) => {
        const moneda = resumen.moneda;
        const debe = sumar(
          cero(moneda),
          ...prestamos
            .filter((p) => p.moneda === moneda && p.estado === 'activo')
            .map((p) => p.saldo),
        );
        const perdido = (ficha.datos?.perdidas ?? []).find((p) => p.moneda === moneda);
        const pago = sumar(resumen.interesCobrado, resumen.moraCobrada, resumen.capitalRecuperado);
        const gano = sumar(resumen.interesCobrado, resumen.moraCobrada);
        return (
          <View key={moneda} style={styles.bloque}>
            <TarjetaDestacada>
              <Texto variante="etiqueta" color={esPositivo(debe) ? tema.primario : tema.alDia}>
                {esPositivo(debe) ? 'Te debe' : 'No te debe nada'}
              </Texto>
              <Monto valor={debe} variante="titulo" />
              <Texto variante="suave" suave>
                Le prestaste {formatear(resumen.capitalEntregado)}
              </Texto>
              {perdido ? (
                <Texto variante="suave" color={tema.vencido}>
                  Perdido {formatear(perdido.perdido)}
                </Texto>
              ) : null}
            </TarjetaDestacada>
            <Tarjeta>
              <Fila>
                <CuadroIcono
                  icono="cash"
                  color={tema.primario}
                  etiqueta="Te pagó"
                  valor={formatear(pago)}
                />
                <View style={[styles.divisor, { backgroundColor: tema.borde }]} />
                <CuadroIcono
                  icono="trending-up"
                  color={tema.alDia}
                  etiqueta="Ganaste"
                  valor={formatear(gano)}
                />
              </Fila>
            </Tarjeta>
          </View>
        );
      })}

      <Boton
        titulo="Nuevo préstamo"
        icono="add-circle"
        onPress={() => router.push({ pathname: '/prestamo/nuevo', params: { clienteId } })}
      />

      {prestamos.length > 0 ? (
        <Seccion titulo="Préstamos">
          {prestamos.map((prestamo) => {
            const perdido = prestamo.estado === 'incobrable';
            const anulado = prestamo.estado === 'anulado';
            const atrasado = !perdido && !anulado && esPositivo(prestamo.vencido);
            const debe = !perdido && !anulado && esPositivo(prestamo.saldo);
            return (
              <Tarjeta
                key={prestamo.prestamoId}
                acento={debe ? (atrasado ? tema.vencido : tema.alDia) : undefined}
                onPress={() =>
                  router.push({ pathname: '/prestamo/[id]', params: { id: prestamo.prestamoId } })
                }>
                <Fila separado>
                  <Texto variante="subtitulo">{ETIQUETA_MODALIDAD[prestamo.modalidad]}</Texto>
                  <Monto valor={prestamo.saldo} variante="subtitulo" />
                </Fila>
                <Fila separado>
                  <Texto variante="suave" suave>
                    {debe && prestamo.proximoVencimiento
                      ? `Próximo pago ${formatearDiaCorto(prestamo.proximoVencimiento)}`
                      : debe
                        ? 'Sin fecha'
                        : ''}
                  </Texto>
                  {perdido ? (
                    <Insignia texto="Perdido" color={tema.vencido} fondo={tema.vencidoSuave} />
                  ) : anulado ? (
                    <Insignia texto="Anulado" color={tema.textSecondary} fondo={tema.neutroSuave} />
                  ) : !debe ? (
                    <Insignia texto="Pagado" color={tema.alDia} fondo={tema.alDiaSuave} />
                  ) : atrasado ? (
                    <Insignia
                      texto={`${prestamo.diasDeAtraso} días de atraso`}
                      color={tema.vencido}
                      fondo={tema.vencidoSuave}
                    />
                  ) : null}
                </Fila>
              </Tarjeta>
            );
          })}
        </Seccion>
      ) : (
        <Vacio titulo="Todavía no le prestaste" />
      )}

      {cobros.length > 0 ? (
        <Seccion titulo="Historial de pagos">
          <Tarjeta>
            {cobros.map((cobro) => (
              <FilaActividad
                key={cobro.pagoId}
                icono={cobro.anulado ? 'close' : 'arrow-down'}
                color={cobro.anulado ? tema.textSecondary : tema.alDia}
                titulo={formatearDiaCorto(cobro.fecha)}
                detalle={cobro.anulado ? 'Anulado' : textoReparto(cobro)}
                monto={cobro.monto}
                entra
                apagado={cobro.anulado}
              />
            ))}
          </Tarjeta>
        </Seccion>
      ) : null}

      <Boton
        titulo="Eliminar cliente"
        icono="trash-outline"
        variante="secundario"
        onPress={() =>
          Alert.alert(`¿Eliminar a ${cliente.nombre}?`, 'Deja de aparecer en la lista de clientes.', [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Eliminar',
              style: 'destructive',
              onPress: async () => {
                try {
                  await enTransaccion(db, () =>
                    eliminarCliente(db, { clienteId, hoy: dia, ahora: ahora() }),
                  );
                  refrescar();
                  router.back();
                } catch (problema) {
                  Alert.alert(
                    'No se puede eliminar',
                    problema instanceof Error ? problema.message : String(problema),
                  );
                }
              },
            },
          ])
        }
      />
    </Pantalla>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  bloque: { gap: 16 },
  divisor: { alignSelf: 'stretch', width: StyleSheet.hairlineWidth },
});
