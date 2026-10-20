/**
 * Ficha del cliente: cuánto le prestaste, cuánto te pagó, cuánto ganaste y cuánto debe;
 * sus préstamos, y abajo el historial de cada pago con su fecha.
 *
 * "Le prestaste" cuenta solo la plata que salió de tu mano: un préstamo que nace de
 * refinanciar otro repite la deuda vieja y no se suma dos veces.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { textoReparto } from '@/components/desglose-de-cobro';
import {
  Boton,
  BotonIcono,
  Cargando,
  Dato,
  Fila,
  Insignia,
  Monto,
  Pantalla,
  Seccion,
  Tarjeta,
  Texto,
  Vacio,
} from '@/components/ui';
import {
  cobrosDetallados,
  comportamientoDeCliente,
  perdidas,
  prestamosDeCliente,
} from '@/datos/consultas';
import { obtenerCliente } from '@/datos/repositorios/clientes';
import { ETIQUETA_MODALIDAD } from '@/dominio/tipos';
import { cero, esPositivo, sumar } from '@/nucleo/dinero';
import { formatearDiaCorto, hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';

export default function PantallaCliente() {
  const tema = useTheme();
  const { refrescar } = useBase();
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
      <Tarjeta>
        <Fila separado>
          <Texto variante="titulo" style={{ flex: 1 }}>
            {cliente.nombre}
          </Texto>
          <BotonIcono
            icono="create-outline"
            etiqueta="Editar cliente"
            onPress={() => router.push({ pathname: '/cliente/editar', params: { id: clienteId } })}
          />
        </Fila>
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
      </Tarjeta>

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
          <Tarjeta key={moneda} acento={esPositivo(debe) ? tema.primario : tema.alDia}>
            <Dato etiqueta="Le prestaste">
              <Monto valor={resumen.capitalEntregado} variante="subtitulo" />
            </Dato>
            <Dato etiqueta="Te pagó">
              <Monto valor={pago} variante="subtitulo" />
            </Dato>
            <Dato etiqueta="Ganaste">
              <Monto valor={gano} color={tema.alDia} />
            </Dato>
            <Dato etiqueta="Debe">
              <Monto valor={debe} variante="titulo" />
            </Dato>
            {perdido ? (
              <Dato etiqueta="Perdido">
                <Monto valor={perdido.perdido} color={tema.vencido} />
              </Dato>
            ) : null}
          </Tarjeta>
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
            const atrasado = !perdido && esPositivo(prestamo.vencido);
            const debe = !perdido && esPositivo(prestamo.saldo);
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
          {cobros.map((cobro) => (
            <Tarjeta key={cobro.pagoId}>
              <Fila separado>
                <Texto variante="subtitulo">{formatearDiaCorto(cobro.fecha)}</Texto>
                <Monto
                  valor={cobro.monto}
                  variante="subtitulo"
                  color={cobro.anulado ? tema.textSecondary : undefined}
                />
              </Fila>
              {cobro.anulado ? (
                <Insignia texto="Anulado" color={tema.vencido} fondo={tema.vencidoSuave} />
              ) : (
                <Texto variante="suave" suave>
                  {textoReparto(cobro)}
                </Texto>
              )}
            </Tarjeta>
          ))}
        </Seccion>
      ) : null}
    </Pantalla>
  );
}
