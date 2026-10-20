/**
 * Detalle de un préstamo: cuánto debe, cuánto pagó, cuánto ganaste, y cada cobro con su
 * reparto entre interés y capital.
 *
 * Es la pantalla que se le muestra al cliente cuando dice "yo te pagué". Nada se borra: un
 * cobro mal anotado se anula con un motivo y queda marcado como anulado.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { textoReparto } from '@/components/desglose-de-cobro';
import {
  Avatar,
  Aviso,
  Boton,
  Campo,
  Cargando,
  CuadroIcono,
  Dato,
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
import { enTransaccion } from '@/datos/base';
import { cobrosDetallados, resumenDePrestamo } from '@/datos/consultas';
import { obtenerCliente } from '@/datos/repositorios/clientes';
import { codigoPaisDe, leerConfiguracion } from '@/datos/repositorios/config';
import { obligacionesDePrestamo } from '@/datos/repositorios/obligaciones';
import { obtenerPrestamo } from '@/datos/repositorios/prestamos';
import { aNumeroDeWhatsApp, mensajeDeRecordatorio } from '@/dominio/mensajes';
import { resumenDeuda, saldoObligacion } from '@/dominio/obligaciones';
import { ETIQUETA_MODALIDAD } from '@/dominio/tipos';
import { enviarPorWhatsApp } from '@/nucleo/compartir';
import {
  cero,
  esPositivo,
  formatear,
  porcentajeDeTasa,
  sumar,
  type PeriodoTasa,
} from '@/nucleo/dinero';
import { ahora, formatearDiaCorto, hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';
import { condonar } from '@/servicios/condonar';
import { darPorPerdido, reactivarPrestamo } from '@/servicios/perder';
import { revertirPago } from '@/servicios/revertir';

const POR_PERIODO: Record<PeriodoTasa, string> = {
  diario: 'por día',
  semanal: 'por semana',
  quincenal: 'por quincena',
  mensual: 'por mes',
  anual: 'por año',
};

export default function PantallaPrestamo() {
  const tema = useTheme();
  const { db, refrescar } = useBase();
  const { id } = useLocalSearchParams<{ id: string }>();
  const prestamoId = Number(id);
  const dia = hoy();

  const ficha = useConsulta(
    async (base) => {
      const prestamo = await obtenerPrestamo(base, prestamoId);
      if (!prestamo) return null;
      return {
        prestamo,
        cliente: await obtenerCliente(base, prestamo.clienteId),
        resumen: await resumenDePrestamo(base, prestamoId, dia),
        obligaciones: await obligacionesDePrestamo(base, prestamoId),
        cobros: await cobrosDetallados(base, { prestamoId }),
        codigoPais: codigoPaisDe(await leerConfiguracion(base)),
      };
    },
    [prestamoId, dia],
  );

  const [anulando, setAnulando] = useState<number | null>(null);
  const [perdiendo, setPerdiendo] = useState(false);
  const [perdonando, setPerdonando] = useState<number | null>(null);
  const [verPerdonables, setVerPerdonables] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  useFocusEffect(useCallback(() => refrescar(), [refrescar]));

  const cerrarFormularios = () => {
    setAnulando(null);
    setPerdiendo(false);
    setPerdonando(null);
    setMotivo('');
  };

  const perdonar = async (obligacionId: number) => {
    setTrabajando(true);
    try {
      const resultado = await enTransaccion(db, () =>
        condonar(db, { obligacionId, motivo, fecha: dia, ahora: ahora() }),
      );
      cerrarFormularios();
      refrescar();
      ficha.recargar();
      Alert.alert('Perdonado', formatear(resultado.condonado));
    } catch (problema) {
      Alert.alert('No se pudo', problema instanceof Error ? problema.message : String(problema));
    } finally {
      setTrabajando(false);
    }
  };

  const perder = async () => {
    setTrabajando(true);
    try {
      const { perdido } = await enTransaccion(db, () =>
        darPorPerdido(db, { prestamoId, motivo, fecha: dia, ahora: ahora() }),
      );
      cerrarFormularios();
      refrescar();
      ficha.recargar();
      Alert.alert('Dado por perdido', formatear(perdido));
    } catch (problema) {
      Alert.alert('No se pudo', problema instanceof Error ? problema.message : String(problema));
    } finally {
      setTrabajando(false);
    }
  };

  const reactivar = async () => {
    setTrabajando(true);
    try {
      await enTransaccion(db, () =>
        reactivarPrestamo(db, { prestamoId, fecha: dia, ahora: ahora() }),
      );
      refrescar();
      ficha.recargar();
    } catch (problema) {
      Alert.alert('No se pudo', problema instanceof Error ? problema.message : String(problema));
    } finally {
      setTrabajando(false);
    }
  };

  const anularPago = async (pagoId: number) => {
    setTrabajando(true);
    try {
      const resultado = await enTransaccion(db, () =>
        revertirPago(db, { pagoId, motivo, fecha: dia, ahora: ahora() }),
      );
      cerrarFormularios();
      refrescar();
      ficha.recargar();
      Alert.alert('Cobro anulado', formatear(resultado.total));
    } catch (problema) {
      Alert.alert('No se pudo', problema instanceof Error ? problema.message : String(problema));
    } finally {
      setTrabajando(false);
    }
  };

  if (ficha.cargando && ficha.datos === null) {
    return (
      <Pantalla>
        <Cargando />
      </Pantalla>
    );
  }

  if (!ficha.datos) {
    return (
      <Pantalla>
        <Vacio titulo="No se encontró el préstamo" />
      </Pantalla>
    );
  }

  const { prestamo, cliente, obligaciones, cobros } = ficha.datos;
  const { condiciones } = prestamo;
  const moneda = condiciones.capital.moneda;
  const deuda = resumenDeuda(obligaciones, moneda, dia);
  const activo = prestamo.estado === 'activo' && esPositivo(deuda.total);
  const perdido = prestamo.estado === 'incobrable';

  // Lo que se puede perdonar: intereses y penalizaciones abiertos. El capital no se perdona:
  // eso es dar el préstamo por perdido.
  const perdonables = activo
    ? obligaciones.filter(
        (o) =>
          (o.tipo === 'interes' || o.tipo === 'mora') &&
          (o.estado === 'pendiente' || o.estado === 'parcial'),
      )
    : [];

  const validos = cobros.filter((c) => !c.anulado);
  const yaPago = sumar(cero(moneda), ...validos.map((c) => c.monto));
  const ganaste = sumar(cero(moneda), ...validos.flatMap((c) => [c.interes, c.penalizacion]));

  const recordar = () =>
    void enviarPorWhatsApp(
      aNumeroDeWhatsApp(cliente?.telefono, ficha.datos!.codigoPais),
      mensajeDeRecordatorio({
        cliente: cliente?.nombre ?? 'Hola',
        vencido: deuda.vencido,
        total: deuda.total,
        vencimiento:
          obligaciones.find(
            (o) => (o.estado === 'pendiente' || o.estado === 'parcial') && o.vencimiento !== null,
          )?.vencimiento ?? null,
        diasDeAtraso: ficha.datos!.resumen?.diasDeAtraso ?? 0,
      }),
    );

  return (
    <Pantalla>
      <Fila>
        <Avatar nombre={cliente?.nombre ?? '?'} grande />
        <View style={styles.flex}>
          <Texto variante="titulo" numberOfLines={2}>
            {cliente?.nombre ?? 'Cliente'}
          </Texto>
          <Texto variante="suave" suave>
            {ETIQUETA_MODALIDAD[condiciones.modalidad]} ·{' '}
            {porcentajeDeTasa(condiciones.tasa).toString().replace('.', ',')}%{' '}
            {POR_PERIODO[condiciones.tasa.periodo]}
          </Texto>
        </View>
        {activo ? null : perdido ? (
            <Insignia texto="Perdido" color={tema.vencido} fondo={tema.vencidoSuave} />
          ) : (
            <Insignia
              texto={prestamo.estado === 'refinanciado' ? 'Refinanciado' : 'Pagado'}
              color={tema.alDia}
              fondo={tema.alDiaSuave}
            />
        )}
      </Fila>

      <TarjetaDestacada>
        <Texto
          variante="etiqueta"
          color={perdido || esPositivo(deuda.vencido) ? tema.vencido : tema.primario}>
          {perdido ? 'Perdido' : activo ? 'Debe' : 'No debe nada'}
        </Texto>
        <Monto
          valor={perdido ? deuda.capital : deuda.total}
          variante="titulo"
          color={perdido ? tema.vencido : undefined}
        />
        {esPositivo(deuda.vencido) && !perdido ? (
          <Texto variante="suave" color={tema.vencido}>
            {formatear(deuda.vencido)} vencido
          </Texto>
        ) : null}
        {esPositivo(deuda.interes) ? (
          <Dato etiqueta="Interés">
            <Monto valor={deuda.interes} />
          </Dato>
        ) : null}
        {esPositivo(deuda.mora) ? (
          <Dato etiqueta="Penalización">
            <Monto valor={deuda.mora} color={tema.vencido} />
          </Dato>
        ) : null}
        <Dato etiqueta="Capital">
          <Monto valor={deuda.capital} />
        </Dato>
      </TarjetaDestacada>

      <Tarjeta>
        <Fila>
          <CuadroIcono
            icono="cash"
            color={tema.primario}
            etiqueta="Ya te pagó"
            valor={formatear(yaPago)}
          />
          <View style={[styles.divisor, { backgroundColor: tema.borde }]} />
          <CuadroIcono
            icono="trending-up"
            color={tema.alDia}
            etiqueta="Ganaste"
            valor={formatear(ganaste)}
          />
        </Fila>
      </Tarjeta>

      <Tarjeta>
        <Dato etiqueta="Prestado">
          <Monto valor={condiciones.capital} />
        </Dato>
        <Dato etiqueta="Entregado">
          <Texto>{formatearDiaCorto(condiciones.fechaDesembolso)}</Texto>
        </Dato>
        {condiciones.vencimientoCapital ? (
          <Dato etiqueta="Capital vence">
            <Texto>{formatearDiaCorto(condiciones.vencimientoCapital)}</Texto>
          </Dato>
        ) : null}
      </Tarjeta>

      {perdonables.length > 0 && !verPerdonables ? (
        <Boton
          titulo="Perdonar interés o penalización"
          icono="heart-outline"
          variante="secundario"
          onPress={() => setVerPerdonables(true)}
        />
      ) : null}

      {verPerdonables ? (
        <Seccion titulo="Perdonar">
          {perdonables.map((o) => (
            <Tarjeta key={o.id}>
              <Fila separado>
                <Texto>
                  {o.tipo === 'mora' ? 'Penalización' : 'Interés'}
                  {o.vencimiento ? ` · ${formatearDiaCorto(o.vencimiento)}` : ''}
                </Texto>
                <Monto valor={saldoObligacion(o)} variante="subtitulo" />
              </Fila>
              {perdonando === o.id ? (
                <>
                  <Campo
                    etiqueta="¿Por qué?"
                    valor={motivo}
                    onChange={setMotivo}
                    placeholder="Le doy una mano este mes"
                    autoFocus
                  />
                  <Fila>
                    <Boton
                      titulo="Cancelar"
                      variante="secundario"
                      onPress={cerrarFormularios}
                      style={{ flex: 1 }}
                    />
                    <Boton
                      titulo="Perdonar"
                      cargando={trabajando}
                      onPress={() => void perdonar(o.id)}
                      style={{ flex: 1 }}
                    />
                  </Fila>
                </>
              ) : (
                <Boton
                  titulo="Perdonar"
                  variante="secundario"
                  onPress={() => {
                    cerrarFormularios();
                    setPerdonando(o.id);
                  }}
                />
              )}
            </Tarjeta>
          ))}
          <Boton
            titulo="Cerrar"
            variante="secundario"
            onPress={() => {
              cerrarFormularios();
              setVerPerdonables(false);
            }}
          />
        </Seccion>
      ) : null}

      {activo ? (
        <>
          <Boton
            titulo="Cobrar"
            icono="cash"
            onPress={() =>
              router.push({ pathname: '/cobrar/[prestamoId]', params: { prestamoId } })
            }
          />
          <Fila>
            <Boton
              titulo="WhatsApp"
              icono="logo-whatsapp"
              variante="secundario"
              onPress={recordar}
              style={{ flex: 1 }}
            />
            <Boton
              titulo="Refinanciar"
              icono="swap-horizontal"
              variante="secundario"
              onPress={() =>
                router.push({ pathname: '/prestamo/refinanciar', params: { prestamoId } })
              }
              style={{ flex: 1 }}
            />
          </Fila>
        </>
      ) : null}

      {perdido ? (
        <>
          {prestamo.motivoCierre ? <Aviso icono="close-circle">{prestamo.motivoCierre}</Aviso> : null}
          <Boton
            titulo="Volvió a pagar"
            icono="refresh"
            variante="secundario"
            cargando={trabajando}
            onPress={() => void reactivar()}
          />
        </>
      ) : null}

      {prestamo.estado === 'refinanciado' && prestamo.motivoCierre ? (
        <Aviso icono="swap-horizontal">{prestamo.motivoCierre}</Aviso>
      ) : null}

      {prestamo.prestamoOrigenId !== null ? (
        <Boton
          titulo="Ver préstamo anterior"
          variante="secundario"
          icono="arrow-back-circle"
          onPress={() =>
            router.push({
              pathname: '/prestamo/[id]',
              params: { id: prestamo.prestamoOrigenId! },
            })
          }
        />
      ) : null}

      <Seccion titulo="Cobros">
        {cobros.length === 0 ? <Vacio titulo="Todavía no pagó nada" /> : null}
        {cobros.length > 0 ? (
          <Tarjeta>
            {cobros.map((cobro) => (
              <View key={cobro.pagoId}>
                <FilaActividad
                  icono={cobro.anulado ? 'close' : 'arrow-down'}
                  color={cobro.anulado ? tema.textSecondary : tema.alDia}
                  titulo={formatearDiaCorto(cobro.fecha)}
                  detalle={cobro.anulado ? 'Anulado' : textoReparto(cobro)}
                  monto={cobro.monto}
                  entra
                  apagado={cobro.anulado}
                  onPress={
                    cobro.anulado
                      ? undefined
                      : () => {
                          cerrarFormularios();
                          setAnulando(anulando === cobro.pagoId ? null : cobro.pagoId);
                        }
                  }
                />
                {anulando === cobro.pagoId ? (
                  <View style={styles.anular}>
                    <Campo
                      etiqueta="Anular este cobro: ¿por qué?"
                      valor={motivo}
                      onChange={setMotivo}
                      placeholder="Me equivoqué de monto"
                      autoFocus
                    />
                    <Fila>
                      <Boton
                        titulo="Cancelar"
                        variante="secundario"
                        onPress={cerrarFormularios}
                        style={{ flex: 1 }}
                      />
                      <Boton
                        titulo="Anular"
                        variante="peligro"
                        onPress={() => void anularPago(cobro.pagoId)}
                        cargando={trabajando}
                        style={{ flex: 1 }}
                      />
                    </Fila>
                  </View>
                ) : null}
              </View>
            ))}
          </Tarjeta>
        ) : null}
      </Seccion>

      {activo && !perdiendo ? (
        <Boton
          titulo="Dar por perdido"
          icono="close-circle-outline"
          variante="secundario"
          onPress={() => {
            cerrarFormularios();
            setPerdiendo(true);
          }}
        />
      ) : null}

      {perdiendo ? (
        <Tarjeta acento={tema.vencido}>
          <Dato etiqueta="Perdés">
            <Monto valor={deuda.capital} variante="subtitulo" color={tema.vencido} />
          </Dato>
          <Campo
            etiqueta="¿Por qué?"
            valor={motivo}
            onChange={setMotivo}
            placeholder="No paga, se fue, no contesta"
            autoFocus
          />
          <Fila>
            <Boton
              titulo="Cancelar"
              variante="secundario"
              onPress={cerrarFormularios}
              style={{ flex: 1 }}
            />
            <Boton
              titulo="Dar por perdido"
              variante="peligro"
              cargando={trabajando}
              onPress={() => void perder()}
              style={{ flex: 1 }}
            />
          </Fila>
        </Tarjeta>
      ) : null}
    </Pantalla>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  divisor: { alignSelf: 'stretch', width: StyleSheet.hairlineWidth },
  anular: { gap: 8, paddingBottom: 8 },
});
