/**
 * Refinanciar un préstamo.
 *
 * Cubre los dos casos del rubro con la misma pantalla: **renovar** (no pagó, se le da más
 * plazo) y **prestarle más** (la deuda vieja más plata nueva). El monto arranca cargado con
 * el saldo actual, así renovar es confirmar y nada más.
 *
 * Muestra siempre la cuenta completa —deuda vieja + plata nueva = capital del préstamo
 * nuevo— y avisa cuando no cierra, porque esa diferencia es plata que se perdona o interés
 * que se suma, y conviene verla antes de firmar.
 *
 * El formulario vive en un componente aparte que recibe los datos ya cargados y arranca su
 * estado desde ellos. Así no hace falta un efecto que llame a `setState` para precargar los
 * campos, que dispara renders en cascada y el lint de React lo marca como error.
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
  Monto,
  Opciones,
  Pantalla,
  Seccion,
  Tarjeta,
  Texto,
  Vacio,
} from '@/components/ui';
import { enTransaccion } from '@/datos/base';
import { obtenerCliente } from '@/datos/repositorios/clientes';
import { obligacionesCobrablesDePrestamo } from '@/datos/repositorios/obligaciones';
import { obtenerPrestamo } from '@/datos/repositorios/prestamos';
import {
  generarCronograma,
  proyectarSoloInteres,
  resumenCronograma,
} from '@/dominio/cronograma';
import { saldoObligacion } from '@/dominio/obligaciones';
import {
  ETIQUETA_MODALIDAD,
  type Cliente,
  type Condiciones,
  type Modalidad,
  type Prestamo,
} from '@/dominio/tipos';
import {
  cero,
  desdeTexto,
  esNegativo,
  esPositivo,
  formatear,
  porcentajeDeTasa,
  sumar,
  tasaDesdePorcentaje,
  type Dinero,
} from '@/nucleo/dinero';
import {
  ahora,
  formatearDiaCorto,
  hoy,
  vencimientoDePeriodo,
  type Frecuencia,
} from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { refinanciar } from '@/servicios/refinanciar';

/**
 * Las formas de pago que se ofrecen. El dominio sabe calcular otras (solo interés, capital
 * fijo, pago único) y los préstamos ya hechos con ellas se siguen mostrando y cobrando; solo
 * no se ofrecen para préstamos nuevos.
 */
const MODALIDADES: Modalidad[] = ['cuota_fija', 'interes_flat'];

const NOMBRE_FRECUENCIA: Record<Frecuencia, string> = {
  diaria: 'días',
  semanal: 'semanas',
  quincenal: 'quincenas',
  mensual: 'meses',
};

type DatosRefinanciacion = {
  readonly prestamo: Prestamo;
  readonly cliente: Cliente | null;
  readonly saldo: Dinero;
};

export default function PantallaRefinanciar() {
  const { prestamoId: parametro } = useLocalSearchParams<{ prestamoId: string }>();
  const prestamoId = Number(parametro);

  const datos = useConsulta<DatosRefinanciacion | null>(
    async (base) => {
      const prestamo = await obtenerPrestamo(base, prestamoId);
      if (!prestamo) return null;

      const cobrables = await obligacionesCobrablesDePrestamo(base, prestamoId);
      const moneda = prestamo.condiciones.capital.moneda;
      return {
        prestamo,
        cliente: await obtenerCliente(base, prestamo.clienteId),
        saldo: cobrables.length === 0 ? cero(moneda) : sumar(...cobrables.map(saldoObligacion)),
      };
    },
    [prestamoId],
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
        <Vacio titulo="No se encontró el préstamo" />
      </Pantalla>
    );
  }

  if (datos.datos.prestamo.estado !== 'activo') {
    return (
      <Pantalla>
        <Vacio
          titulo="Este préstamo ya está cerrado"
          detalle={datos.datos.prestamo.estado}
        />
      </Pantalla>
    );
  }

  return <Formulario datos={datos.datos} />;
}

function Formulario({ datos }: { datos: DatosRefinanciacion }) {
  const { db, refrescar } = useBase();
  const dia = hoy();

  const { prestamo, cliente, saldo } = datos;
  const moneda = prestamo.condiciones.capital.moneda;

  // El estado arranca con las condiciones del préstamo viejo: lo habitual es renovar con lo
  // mismo, así renovar es confirmar y nada más.
  const [capitalTexto, setCapitalTexto] = useState(() =>
    formatear(saldo, { sinSimbolo: true }),
  );
  const [efectivoTexto, setEfectivoTexto] = useState('');
  const [tasaTexto, setTasaTexto] = useState(() =>
    porcentajeDeTasa(prestamo.condiciones.tasa).toString().replace('.', ','),
  );
  // Un préstamo viejo de otra modalidad se refinancia a una de las que se ofrecen.
  const [modalidad, setModalidad] = useState<Modalidad>(
    MODALIDADES.includes(prestamo.condiciones.modalidad)
      ? prestamo.condiciones.modalidad
      : 'cuota_fija',
  );
  const [frecuencia, setFrecuencia] = useState<Frecuencia>(prestamo.condiciones.frecuencia);
  const [plazoTexto, setPlazoTexto] = useState(
    String(prestamo.condiciones.cantidadPeriodos ?? 6),
  );
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const esAbierto = modalidad === 'solo_interes';
  const plazo = Number(plazoTexto);

  const efectivo = useMemo<Dinero>(() => {
    if (!efectivoTexto.trim()) return cero(moneda);
    try {
      return desdeTexto(efectivoTexto, moneda);
    } catch {
      return cero(moneda);
    }
  }, [efectivoTexto, moneda]);

  const condiciones = useMemo<Condiciones | null>(() => {
    try {
      const capital = desdeTexto(capitalTexto, moneda);
      if (!esPositivo(capital)) return null;

      const porcentaje = Number(tasaTexto.replace(',', '.'));
      if (!Number.isFinite(porcentaje) || porcentaje < 0) return null;
      if (!Number.isInteger(plazo) || plazo < 1) return null;

      return {
        capital,
        tasa: tasaDesdePorcentaje(porcentaje, prestamo.condiciones.tasa.periodo),
        modalidad,
        frecuencia,
        cantidadPeriodos: esAbierto ? null : plazo,
        fechaDesembolso: dia,
        vencimientoCapital: vencimientoDePeriodo(dia, frecuencia, plazo),
      };
    } catch {
      return null;
    }
  }, [
    capitalTexto,
    moneda,
    tasaTexto,
    plazo,
    modalidad,
    frecuencia,
    esAbierto,
    dia,
    prestamo.condiciones.tasa.periodo,
  ]);

  const vista = useMemo(() => {
    if (!condiciones) return null;
    try {
      const lineas = esAbierto
        ? proyectarSoloInteres(condiciones, plazo)
        : generarCronograma(condiciones);
      return { lineas, resumen: resumenCronograma(lineas) };
    } catch {
      return null;
    }
  }, [condiciones, esAbierto, plazo]);

  const diferencia = useMemo<Dinero | null>(() => {
    if (!condiciones) return null;
    return {
      centavos: condiciones.capital.centavos - saldo.centavos - efectivo.centavos,
      moneda,
    };
  }, [condiciones, saldo, efectivo, moneda]);

  const confirmar = async () => {
    if (!condiciones) return;
    if (motivo.trim().length < 3) {
      Alert.alert('Falta el motivo', 'Escribí por qué se refinancia: queda en el libro.');
      return;
    }

    setGuardando(true);
    try {
      const resultado = await enTransaccion(db, () =>
        refinanciar(db, {
          prestamoId: prestamo.id,
          condiciones,
          efectivoEntregado: efectivo,
          motivo,
          fecha: dia,
          ahora: ahora(),
        }),
      );
      refrescar();

      Alert.alert(
        'Refinanciado',
        `Se trasladaron ${formatear(resultado.saldoTrasladado)} al préstamo nuevo.` +
          (esPositivo(efectivo) ? `\nEntregaste ${formatear(efectivo)} en mano.` : ''),
        [
          {
            text: 'Ver el préstamo nuevo',
            onPress: () =>
              router.replace({
                pathname: '/prestamo/[id]',
                params: { id: resultado.prestamoNuevoId },
              }),
          },
        ],
      );
    } catch (problema) {
      Alert.alert(
        'No se pudo refinanciar',
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
          Refinanciar
        </Texto>
        <Texto variante="titulo">{cliente?.nombre ?? 'Cliente'}</Texto>
        <Dato etiqueta="Debe hoy">
          <Monto valor={saldo} variante="subtitulo" />
        </Dato>
        <Dato etiqueta="Prestado originalmente">
          <Monto valor={prestamo.condiciones.capital} />
        </Dato>
      </Tarjeta>

      <Seccion titulo="El préstamo nuevo">
        <Campo
          etiqueta="Capital"
          valor={capitalTexto}
          onChange={setCapitalTexto}
          teclado="decimal-pad"
        />
        <Campo
          etiqueta="Plata que le entregás en mano"
          valor={efectivoTexto}
          onChange={setEfectivoTexto}
          placeholder="0"
          teclado="decimal-pad"
        />
        <Campo
          etiqueta={`Tasa (% ${prestamo.condiciones.tasa.periodo})`}
          valor={tasaTexto}
          onChange={setTasaTexto}
          teclado="decimal-pad"
        />
        <Opciones
          etiqueta="Modalidad"
          valor={modalidad}
          onChange={setModalidad}
          opciones={MODALIDADES.map((valor) => ({ valor, titulo: ETIQUETA_MODALIDAD[valor] }))}
        />
        <Opciones
          etiqueta="Cada cuánto cobrás"
          valor={frecuencia}
          onChange={setFrecuencia}
          opciones={[
            { valor: 'diaria', titulo: 'Diario' },
            { valor: 'semanal', titulo: 'Semanal' },
            { valor: 'quincenal', titulo: 'Quincenal' },
            { valor: 'mensual', titulo: 'Mensual' },
          ]}
        />
        <Campo
          etiqueta={esAbierto ? `Plazo (${NOMBRE_FRECUENCIA[frecuencia]})` : 'Cantidad de cuotas'}
          valor={plazoTexto}
          onChange={(valor) => setPlazoTexto(valor.replace(/\D/g, ''))}
          teclado="numeric"
        />
      </Seccion>

      {condiciones && diferencia ? (
        <Seccion titulo="La cuenta">
          <Tarjeta>
            <Dato etiqueta="Deuda que se traslada">
              <Monto valor={saldo} />
            </Dato>
            <Dato etiqueta="Plata nueva en mano">
              <Monto valor={efectivo} />
            </Dato>
            <Dato etiqueta="Capital del préstamo nuevo">
              <Monto valor={condiciones.capital} variante="subtitulo" />
            </Dato>
          </Tarjeta>

          {esPositivo(diferencia) ? (
            <Aviso>
              La cuenta no cierra por {formatear(diferencia)} de más. Si es algo que acordaron
              sumar, está bien; si no, revisá el capital.
            </Aviso>
          ) : esNegativo(diferencia) ? (
            <Aviso tono="bien" icono="heart">
              Le estás perdonando {formatear({ centavos: -diferencia.centavos, moneda })}.
              Queda registrado en el libro.
            </Aviso>
          ) : null}
        </Seccion>
      ) : null}

      {vista ? (
        <Seccion titulo="Cómo queda">
          <Tarjeta>
            {esAbierto ? (
              <>
                <Dato etiqueta={`Interés por ${NOMBRE_FRECUENCIA[frecuencia].slice(0, -1)}`}>
                  <Monto valor={vista.lineas[0].interes} variante="subtitulo" />
                </Dato>
                <Dato etiqueta="Capital vence">
                  <Texto>
                    {formatearDiaCorto(vista.lineas[vista.lineas.length - 1].vencimiento)}
                  </Texto>
                </Dato>
              </>
            ) : (
              <>
                <Dato etiqueta="Cuota">
                  <Monto valor={vista.resumen.cuotaMaxima} variante="subtitulo" />
                </Dato>
                <Dato etiqueta="Interés total">
                  <Monto valor={vista.resumen.totalInteres} />
                </Dato>
                <Dato etiqueta="Total a pagar">
                  <Monto valor={vista.resumen.totalAPagar} variante="subtitulo" />
                </Dato>
              </>
            )}
          </Tarjeta>
        </Seccion>
      ) : null}

      <Campo
        etiqueta="¿Por qué se refinancia?"
        valor={motivo}
        onChange={setMotivo}
        placeholder="No pudo pagar, le damos más plazo…"
        multilinea
      />

      <Boton
        titulo="Refinanciar"
        icono="swap-horizontal"
        onPress={confirmar}
        cargando={guardando}
        deshabilitado={!vista}
      />
    </Pantalla>
  );
}
