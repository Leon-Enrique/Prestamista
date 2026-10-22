/**
 * Registrar un cobro.
 *
 * Antes de confirmar muestra **a dónde va cada boliviano**: cuánto a mora, cuánto a interés
 * y cuánto a capital. Es la pantalla que se usa con el cliente enfrente, y poder decirle
 * "de los 400, 21 son de mora y 379 de interés" es la diferencia entre una discusión y un
 * recibo.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, StyleSheet, View } from 'react-native';

import {
  Avatar,
  Aviso,
  Boton,
  Campo,
  Cargando,
  CuadroIcono,
  Dato,
  Fila,
  Monto,
  Opciones,
  Pantalla,
  Seccion,
  Tarjeta,
  TarjetaDestacada,
  Texto,
  Vacio,
} from '@/components/ui';
import { enTransaccion } from '@/datos/base';
import {
  codigoPaisDe,
  leerConfiguracion,
  ordenComponentesDe,
} from '@/datos/repositorios/config';
import { obtenerCliente } from '@/datos/repositorios/clientes';
import { obligacionesCobrablesDePrestamo } from '@/datos/repositorios/obligaciones';
import { obtenerPrestamo } from '@/datos/repositorios/prestamos';
import {
  desgloseDeImputacion,
  imputarConReparto,
  imputarPago,
  pendientePorComponente,
  totalParaSaldar,
} from '@/dominio/imputacion';
import { aNumeroDeWhatsApp, mensajeDeRecibo } from '@/dominio/mensajes';
import { resumenDeuda } from '@/dominio/obligaciones';
import { MEDIOS_DE_PAGO, type MedioPago } from '@/dominio/tipos';
import { enviarPorWhatsApp } from '@/nucleo/compartir';
import { cero, desdeTexto, esPositivo, formatear, restar, sumar, type Dinero } from '@/nucleo/dinero';
import { ahora, hoy, type Dia } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';
import { cobrar, type ResultadoCobro } from '@/servicios/cobrar';

const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  qr: 'QR',
  otro: 'Otro',
};

export default function PantallaCobrar() {
  const tema = useTheme();
  const { db, refrescar } = useBase();
  const { prestamoId: parametro } = useLocalSearchParams<{ prestamoId: string }>();
  const prestamoId = Number(parametro);
  const dia = hoy();

  const datos = useConsulta(
    async (base) => {
      const prestamo = await obtenerPrestamo(base, prestamoId);
      if (!prestamo) return null;
      const configuracion = await leerConfiguracion(base);
      return {
        prestamo,
        cliente: await obtenerCliente(base, prestamo.clienteId),
        obligaciones: await obligacionesCobrablesDePrestamo(base, prestamoId),
        componentes: ordenComponentesDe(configuracion),
        codigoPais: codigoPaisDe(configuracion),
      };
    },
    [prestamoId, dia],
  );

  const [montoTexto, setMontoTexto] = useState('');
  // "elegido": el usuario dice cuánto va a interés y cuánto a capital.
  const [modo, setModo] = useState<'recomendado' | 'elegido'>('recomendado');
  const [interesTexto, setInteresTexto] = useState('');
  const [capitalTexto, setCapitalTexto] = useState('');
  const [moraTexto, setMoraTexto] = useState('');
  const [medio, setMedio] = useState<MedioPago>('efectivo');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [cobrado, setCobrado] = useState<{
    resultado: ResultadoCobro;
    saldoRestante: Dinero;
  } | null>(null);

  const moneda = datos.datos?.prestamo.condiciones.capital.moneda ?? 'BOB';

  const deuda = useMemo(() => {
    if (!datos.datos) return null;
    return resumenDeuda(datos.datos.obligaciones, moneda, dia);
  }, [datos.datos, moneda, dia]);

  const aSaldar = useMemo(() => {
    if (!datos.datos) return null;
    return totalParaSaldar(datos.datos.obligaciones, moneda);
  }, [datos.datos, moneda]);

  const vista = useMemo(() => {
    if (!datos.datos || !montoTexto.trim()) return null;
    try {
      const monto = desdeTexto(montoTexto, moneda);
      if (!esPositivo(monto)) return null;
      const resultado = imputarPago({
        monto,
        obligaciones: datos.datos.obligaciones,
        hasta: dia,
        componentes: datos.datos.componentes,
      });
      return { monto, resultado, desglose: desgloseDeImputacion(resultado, moneda) };
    } catch {
      return null;
    }
  }, [datos.datos, montoTexto, moneda, dia]);

  const pendiente = useMemo(
    () => (datos.datos ? pendientePorComponente(datos.datos.obligaciones, moneda) : null),
    [datos.datos, moneda],
  );

  // El reparto elegido: cada campo vacío cuenta como cero.
  const elegida = useMemo(() => {
    if (!datos.datos || modo !== 'elegido') return null;
    const leer = (texto: string): Dinero | null => {
      if (!texto.trim()) return cero(moneda);
      try {
        return desdeTexto(texto, moneda);
      } catch {
        return null;
      }
    };
    const interes = leer(interesTexto);
    const capital = leer(capitalTexto);
    const mora = leer(moraTexto);
    if (!interes || !capital || !mora) return { error: 'Revisá los montos.' };
    try {
      const resultado = imputarConReparto({
        reparto: { interes, capital, mora },
        obligaciones: datos.datos.obligaciones,
        hasta: dia,
      });
      return {
        vista: {
          monto: resultado.aplicado,
          resultado,
          desglose: desgloseDeImputacion(resultado, moneda),
          reparto: { interes, capital, mora },
        },
      };
    } catch (problema) {
      const total = sumar(interes, capital, mora);
      return esPositivo(total)
        ? { error: problema instanceof Error ? problema.message : String(problema) }
        : null;
    }
  }, [datos.datos, modo, interesTexto, capitalTexto, moraTexto, moneda, dia]);

  const activa = modo === 'elegido' ? (elegida?.vista ?? null) : vista;

  /** Pasa a "lo elijo yo" con el reparto recomendado de lo que ya se escribió. */
  const elegirReparto = (nuevo: 'recomendado' | 'elegido') => {
    if (nuevo === 'elegido' && vista) {
      const texto = (d: Dinero) => (esPositivo(d) ? formatear(d, { sinSimbolo: true }) : '');
      setInteresTexto(texto(vista.desglose.interes));
      setCapitalTexto(texto(vista.desglose.capital));
      setMoraTexto(texto(vista.desglose.mora));
    }
    if (nuevo === 'recomendado' && elegida?.vista) {
      setMontoTexto(formatear(elegida.vista.monto, { sinSimbolo: true }));
    }
    setModo(nuevo);
  };

  /** Todo lo que se escribió pasa a capital. */
  const soloCapital = () => {
    const total = elegida?.vista?.monto ?? vista?.monto ?? null;
    setInteresTexto('');
    setMoraTexto('');
    if (total) setCapitalTexto(formatear(total, { sinSimbolo: true }));
  };

  const confirmar = async () => {
    if (!activa) return;
    setGuardando(true);
    try {
      const resultado = await enTransaccion(db, () =>
        cobrar(db, {
          prestamoId,
          monto: activa.monto,
          reparto: modo === 'elegido' && elegida?.vista ? elegida.vista.reparto : undefined,
          fecha: dia,
          medio,
          nota,
          ahora: ahora(),
        }),
      );
      refrescar();

      // Se queda en la pantalla con el recibo a la vista en vez de volver: lo que sigue es
      // mandárselo al cliente, y para eso hay que poder leerlo con calma.
      setCobrado({
        resultado,
        saldoRestante: restar(deuda?.total ?? resultado.aplicado, resultado.aplicado),
      });
    } catch (problema) {
      Alert.alert(
        'No se pudo registrar',
        problema instanceof Error ? problema.message : String(problema),
      );
    } finally {
      setGuardando(false);
    }
  };

  if (datos.cargando && datos.datos === null) {
    return (
      <Pantalla>
        <Cargando />
      </Pantalla>
    );
  }

  if (!datos.datos) {
    return (
      <Pantalla>
        <Vacio titulo="No se encontró el préstamo" />
      </Pantalla>
    );
  }

  const { cliente, obligaciones } = datos.datos;

  // Va antes del chequeo de deuda: si el cobro saldó el préstamo, la consulta ya se refrescó
  // y no quedan obligaciones — pero el recibo todavía tiene que poder verse y mandarse.
  if (cobrado) {
    return (
      <VistaRecibo
        cobrado={cobrado}
        cliente={cliente?.nombre ?? 'Cliente'}
        telefono={cliente?.telefono ?? null}
        codigoPais={datos.datos.codigoPais}
        fecha={dia}
      />
    );
  }

  if (obligaciones.length === 0) {
    return (
      <Pantalla>
        <Vacio titulo="Préstamo pagado" />
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <Fila>
        <Avatar nombre={cliente?.nombre ?? '?'} grande />
        <Texto variante="titulo" numberOfLines={2} style={estilos.flex}>
          {cliente?.nombre ?? 'Cliente'}
        </Texto>
      </Fila>

      {deuda ? (
        <TarjetaDestacada>
          <Texto
            variante="etiqueta"
            color={esPositivo(deuda.vencido) ? tema.vencido : tema.primario}>
            Debe
          </Texto>
          <Monto valor={deuda.total} variante="titulo" />
          {esPositivo(deuda.vencido) ? (
            <Texto variante="suave" color={tema.vencido}>
              {formatear(deuda.vencido)} vencido
            </Texto>
          ) : null}
        </TarjetaDestacada>
      ) : null}

      <Seccion titulo="Cuánto paga">
        <Opciones
          etiqueta="Reparto"
          valor={modo}
          onChange={elegirReparto}
          opciones={[
            { valor: 'recomendado', titulo: 'Recomendado' },
            { valor: 'elegido', titulo: 'Lo elijo yo' },
          ]}
        />

        {modo === 'recomendado' ? (
          <>
            <Campo
              etiqueta="Monto"
              valor={montoTexto}
              onChange={setMontoTexto}
              placeholder="0"
              teclado="decimal-pad"
              autoFocus
            />
            {aSaldar && esPositivo(aSaldar) ? (
              <Boton
                titulo={`Todo: ${formatear(aSaldar)}`}
                variante="secundario"
                onPress={() => setMontoTexto(formatear(aSaldar, { sinSimbolo: true }))}
              />
            ) : null}
          </>
        ) : (
          <>
            {pendiente && esPositivo(pendiente.mora) ? (
              <Campo
                etiqueta="A penalización"
                valor={moraTexto}
                onChange={setMoraTexto}
                placeholder={`Hasta ${formatear(pendiente.mora)}`}
                teclado="decimal-pad"
              />
            ) : null}
            <Campo
              etiqueta="A interés"
              valor={interesTexto}
              onChange={setInteresTexto}
              placeholder={pendiente ? `Hasta ${formatear(pendiente.interes)}` : '0'}
              teclado="decimal-pad"
            />
            <Campo
              etiqueta="A capital"
              valor={capitalTexto}
              onChange={setCapitalTexto}
              placeholder={pendiente ? `Hasta ${formatear(pendiente.capital)}` : '0'}
              teclado="decimal-pad"
            />
            <Boton titulo="Solo capital" variante="secundario" icono="arrow-undo" onPress={soloCapital} />
            {elegida?.error ? <Aviso tono="peligro">{elegida.error}</Aviso> : null}
          </>
        )}

        <Opciones
          etiqueta="Medio"
          valor={medio}
          onChange={setMedio}
          opciones={MEDIOS_DE_PAGO.map((valor) => ({ valor, titulo: ETIQUETA_MEDIO[valor] }))}
        />
      </Seccion>

      {activa ? (
        <Seccion titulo={`Paga ${formatear(activa.monto)}`}>
          <Tarjeta>
            <Fila>
              <CuadroIcono
                icono="trending-up"
                color={tema.alDia}
                etiqueta="Interés (ganancia)"
                valor={formatear(sumar(activa.desglose.interes, activa.desglose.mora))}
              />
              <View style={[estilos.divisor, { backgroundColor: tema.borde }]} />
              <CuadroIcono
                icono="arrow-undo"
                color={tema.primario}
                etiqueta="Capital"
                valor={formatear(activa.desglose.capital)}
              />
            </Fila>
            {esPositivo(activa.desglose.mora) ? (
              <Dato etiqueta="de eso, penalización">
                <Monto valor={activa.desglose.mora} />
              </Dato>
            ) : null}
            {esPositivo(activa.resultado.sobrante) ? (
              <Dato etiqueta="Le queda a favor">
                <Monto valor={activa.resultado.sobrante} />
              </Dato>
            ) : null}
          </Tarjeta>
        </Seccion>
      ) : null}

      <Campo
        etiqueta="Nota"
        valor={nota}
        onChange={setNota}
        placeholder="Opcional"
      />

      <Boton
        titulo="Registrar el cobro"
        icono="checkmark-circle"
        onPress={confirmar}
        cargando={guardando}
        deshabilitado={!activa}
      />

      <Boton
        titulo="Ver historial del préstamo"
        variante="secundario"
        icono="time-outline"
        onPress={() => router.push({ pathname: '/prestamo/[id]', params: { id: prestamoId } })}
      />
    </Pantalla>
  );
}

/**
 * El recibo, después de registrar el cobro.
 *
 * Se queda en pantalla en vez de volver atrás: lo que sigue es mandárselo al cliente, y para
 * eso hay que poder leerlo con calma. El mensaje se abre en WhatsApp ya escrito, y enviarlo
 * es siempre una decisión del usuario.
 */
function VistaRecibo({
  cobrado,
  cliente,
  telefono,
  codigoPais,
  fecha,
}: {
  cobrado: { resultado: ResultadoCobro; saldoRestante: Dinero };
  cliente: string;
  telefono: string | null;
  codigoPais: string;
  fecha: Dia;
}) {
  const tema = useTheme();
  const { resultado, saldoRestante } = cobrado;
  const [enviando, setEnviando] = useState(false);

  const texto = mensajeDeRecibo({
    cliente,
    monto: resultado.aplicado,
    fecha,
    desglose: resultado.desglose,
    saldoRestante,
    prestamoCerrado: resultado.prestamoCerrado,
  });

  const mandar = async () => {
    setEnviando(true);
    try {
      const destino = await enviarPorWhatsApp(aNumeroDeWhatsApp(telefono, codigoPais), texto);
      if (destino === 'compartir' && telefono === null) {
        Alert.alert(
          'Sin teléfono',
          'Elegí por dónde mandarlo.',
        );
      }
    } catch (problema) {
      Alert.alert(
        'No se pudo abrir',
        problema instanceof Error ? problema.message : String(problema),
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Pantalla>
      <TarjetaDestacada>
        <Fila separado>
          <Texto variante="etiqueta" color={tema.alDia}>
            Cobrado
          </Texto>
          <Ionicons name="checkmark-circle" size={26} color={tema.alDia} />
        </Fila>
        <Monto valor={resultado.aplicado} variante="titulo" />
        <Texto variante="suave" suave>
          {cliente}
        </Texto>
        {esPositivo(resultado.desglose.mora) ? (
          <Dato etiqueta="Penalización">
            <Monto valor={resultado.desglose.mora} />
          </Dato>
        ) : null}
        {esPositivo(resultado.desglose.interes) ? (
          <Dato etiqueta="Interés">
            <Monto valor={resultado.desglose.interes} />
          </Dato>
        ) : null}
        {esPositivo(resultado.desglose.capital) ? (
          <Dato etiqueta="Capital">
            <Monto valor={resultado.desglose.capital} />
          </Dato>
        ) : null}
        <Dato etiqueta="Debe">
          <Monto valor={saldoRestante} variante="subtitulo" />
        </Dato>
      </TarjetaDestacada>

      {resultado.prestamoCerrado ? (
        <Aviso tono="bien" icono="flag">
          Préstamo pagado
        </Aviso>
      ) : null}

      {esPositivo(resultado.sobrante) ? (
        <Aviso>A favor del cliente: {formatear(resultado.sobrante)}</Aviso>
      ) : null}

      <Boton
        titulo="Mandar recibo por WhatsApp"
        icono="logo-whatsapp"
        onPress={mandar}
        cargando={enviando}
      />

      <Boton titulo="Listo" variante="secundario" onPress={() => router.back()} />
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  flex: { flex: 1 },
  divisor: { alignSelf: 'stretch', width: StyleSheet.hairlineWidth },
});
