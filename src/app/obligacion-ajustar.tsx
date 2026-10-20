/**
 * Ajustar una cuota negociada.
 *
 * "Este mes pagame 200 menos y lo acomodamos", "te doy una semana más". El cronograma existe
 * como dato editable con rastro justamente para poder anotar esto.
 *
 * Las fechas se mueven con botones y no escribiendo: se usa de pie, y nadie quiere tipear
 * una fecha completa con el cliente esperando.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import {
  Aviso,
  Boton,
  Campo,
  Cargando,
  Dato,
  Fila,
  Monto,
  Pantalla,
  Seccion,
  Tarjeta,
  Texto,
  Vacio,
} from '@/components/ui';
import { enTransaccion } from '@/datos/base';
import { obtenerCliente } from '@/datos/repositorios/clientes';
import { obtenerObligacion } from '@/datos/repositorios/obligaciones';
import { obtenerPrestamo } from '@/datos/repositorios/prestamos';
import { pagadoDe, saldoObligacion } from '@/dominio/obligaciones';
import { ETIQUETA_MODALIDAD, type Obligacion } from '@/dominio/tipos';
import { desdeTexto, esPositivo, formatear, sumar, type Dinero } from '@/nucleo/dinero';
import {
  ahora,
  formatearDiaCorto,
  hoy,
  sumarDias,
  sumarMeses,
  type Dia,
} from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';
import { ajustar } from '@/servicios/ajustar';

type DatosAjuste = {
  readonly obligacion: Obligacion;
  readonly cliente: string;
  readonly modalidad: string;
};

export default function PantallaAjustarObligacion() {
  const { obligacionId: parametro } = useLocalSearchParams<{ obligacionId: string }>();
  const obligacionId = Number(parametro);

  const datos = useConsulta<DatosAjuste | null>(
    async (base) => {
      const obligacion = await obtenerObligacion(base, obligacionId);
      if (!obligacion) return null;

      const prestamo = await obtenerPrestamo(base, obligacion.prestamoId);
      const cliente = prestamo ? await obtenerCliente(base, prestamo.clienteId) : null;
      return {
        obligacion,
        cliente: cliente?.nombre ?? 'Cliente',
        modalidad: prestamo ? ETIQUETA_MODALIDAD[prestamo.condiciones.modalidad] : '',
      };
    },
    [obligacionId],
  );

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
        <Vacio titulo="No se encontró la cuota" />
      </Pantalla>
    );
  }

  const { obligacion } = datos.datos;
  if (obligacion.estado !== 'pendiente' && obligacion.estado !== 'parcial') {
    return (
      <Pantalla>
        <Vacio
          titulo="Esta cuota ya no se puede ajustar"
          detalle={`Está "${obligacion.estado}".`}
        />
      </Pantalla>
    );
  }

  return <Formulario datos={datos.datos} />;
}

function Formulario({ datos }: { datos: DatosAjuste }) {
  const tema = useTheme();
  const { db, refrescar } = useBase();
  const dia = hoy();

  const { obligacion, cliente, modalidad } = datos;
  const moneda = obligacion.moneda;
  const original = obligacion.vencimiento;

  const [capitalTexto, setCapitalTexto] = useState(() =>
    formatear(obligacion.capital, { sinSimbolo: true }),
  );
  const [interesTexto, setInteresTexto] = useState(() =>
    formatear(obligacion.interes, { sinSimbolo: true }),
  );
  const [vencimiento, setVencimiento] = useState<Dia | null>(original);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const nuevoCapital = useMemo(() => leerMonto(capitalTexto, moneda), [capitalTexto, moneda]);
  const nuevoInteres = useMemo(() => leerMonto(interesTexto, moneda), [interesTexto, moneda]);

  const totalAntes = sumar(obligacion.capital, obligacion.interes);
  const totalDespues = nuevoCapital && nuevoInteres ? sumar(nuevoCapital, nuevoInteres) : null;
  const diferencia: Dinero | null = totalDespues
    ? { centavos: totalDespues.centavos - totalAntes.centavos, moneda }
    : null;

  const pagadoCapital = pagadoDe(obligacion, 'capital');
  const pagadoInteres = pagadoDe(obligacion, 'interes');
  const hayAlgoCobrado = esPositivo(pagadoCapital) || esPositivo(pagadoInteres);

  const moverFecha = (mover: (desde: Dia) => Dia) => {
    setVencimiento((actual) => (actual === null ? null : mover(actual)));
  };

  const guardar = async () => {
    if (!nuevoCapital || !nuevoInteres) return;
    if (motivo.trim().length < 3) {
      Alert.alert('Falta el motivo', 'Escribí qué se acordó: queda en el libro.');
      return;
    }

    setGuardando(true);
    try {
      const resultado = await enTransaccion(db, () =>
        ajustar(db, {
          obligacionId: obligacion.id,
          nuevoCapital,
          nuevoInteres,
          nuevoVencimiento: vencimiento === original ? undefined : vencimiento,
          motivo,
          fecha: dia,
          ahora: ahora(),
        }),
      );
      refrescar();

      const cambio =
        resultado.diferencia.centavos === 0
          ? 'La cuota quedó con el mismo total.'
          : resultado.diferencia.centavos < 0
            ? `Le bajaste ${formatear({ centavos: -resultado.diferencia.centavos, moneda })}.`
            : `Le subiste ${formatear(resultado.diferencia)}.`;

      Alert.alert('Cuota ajustada', cambio, [{ text: 'Listo', onPress: () => router.back() }]);
    } catch (problema) {
      Alert.alert(
        'No se pudo ajustar',
        problema instanceof Error ? problema.message : String(problema),
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Pantalla>
      <Tarjeta>
        <Texto variante="etiqueta" suave>
          {modalidad}
        </Texto>
        <Texto variante="titulo">{cliente}</Texto>
        <Dato etiqueta="Debe de esta cuota">
          <Monto valor={saldoObligacion(obligacion)} variante="subtitulo" />
        </Dato>
        {hayAlgoCobrado ? (
          <Dato etiqueta="Ya cobrado">
            <Monto valor={sumar(pagadoCapital, pagadoInteres)} />
          </Dato>
        ) : null}
      </Tarjeta>

      <Seccion titulo="Montos de la cuota">
        <Campo
          etiqueta="Capital"
          valor={capitalTexto}
          onChange={setCapitalTexto}
          teclado="decimal-pad"
        />
        <Campo
          etiqueta="Interés"
          valor={interesTexto}
          onChange={setInteresTexto}
          teclado="decimal-pad"
        />
      </Seccion>

      {original !== null ? (
        <Seccion titulo="Vencimiento">
          <Tarjeta>
            <Dato etiqueta="Vence">
              <Texto variante="subtitulo">
                {vencimiento ? formatearDiaCorto(vencimiento) : 'sin fecha'}
              </Texto>
            </Dato>
            {vencimiento !== original ? (
              <Texto variante="suave" suave>
                Antes vencía {formatearDiaCorto(original)}.
              </Texto>
            ) : null}
          </Tarjeta>

          <Fila>
            <Boton
              titulo="+1 semana"
              variante="secundario"
              onPress={() => moverFecha((desde) => sumarDias(desde, 7))}
              style={{ flex: 1 }}
            />
            <Boton
              titulo="+1 mes"
              variante="secundario"
              onPress={() => moverFecha((desde) => sumarMeses(desde, 1))}
              style={{ flex: 1 }}
            />
          </Fila>

          {vencimiento !== original ? (
            <Boton
              titulo="Volver a la fecha original"
              variante="secundario"
              icono="arrow-undo"
              onPress={() => setVencimiento(original)}
            />
          ) : null}
        </Seccion>
      ) : null}

      {diferencia ? (
        <Seccion titulo="Cómo queda">
          <Tarjeta acento={diferencia.centavos === 0 ? undefined : tema.primario}>
            <Dato etiqueta="Total antes">
              <Monto valor={totalAntes} />
            </Dato>
            <Dato etiqueta="Total después">
              <Monto valor={totalDespues!} variante="subtitulo" />
            </Dato>
            {diferencia.centavos !== 0 ? (
              <Dato etiqueta={diferencia.centavos < 0 ? 'Le bajás' : 'Le subís'}>
                <Monto
                  valor={{ centavos: Math.abs(diferencia.centavos), moneda }}
                  color={diferencia.centavos < 0 ? tema.alDia : tema.aviso}
                />
              </Dato>
            ) : null}
          </Tarjeta>

        </Seccion>
      ) : (
        <Aviso tono="peligro">Revisá los montos.</Aviso>
      )}

      <Campo
        etiqueta="Qué se acordó"
        valor={motivo}
        onChange={setMotivo}
        placeholder="Este mes no le alcanzaba, lo pone el que viene…"
        multilinea
      />

      <Boton
        titulo="Guardar el ajuste"
        icono="create"
        onPress={guardar}
        cargando={guardando}
        deshabilitado={!diferencia}
      />
    </Pantalla>
  );
}

/** Lee un monto del campo. `null` si no se entiende o es negativo. */
function leerMonto(texto: string, moneda: Dinero['moneda']): Dinero | null {
  if (!texto.trim()) return null;
  try {
    const valor = desdeTexto(texto, moneda);
    return valor.centavos < 0 ? null : valor;
  } catch {
    return null;
  }
}
