/**
 * Alta de un préstamo.
 *
 * Muestra el **interés en bolivianos y el total a pagar** junto al porcentaje, siempre: es la
 * cifra con la que se decide y la que el cliente pregunta. Un "10% mensual" solo no le dice
 * nada a nadie, y la misma tasa rinde muy distinto según la modalidad.
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
  Opciones,
  Pantalla,
  Seccion,
  Tarjeta,
  TarjetaDestacada,
  Texto,
  Vacio,
} from '@/components/ui';
import { CampoFecha } from '@/components/campo-fecha';
import { enTransaccion } from '@/datos/base';
import { listarClientes } from '@/datos/repositorios/clientes';
import { leerConfiguracion, reglasMoraDe } from '@/datos/repositorios/config';
import {
  generarCronograma,
  proyectarSoloInteres,
  resumenCronograma,
} from '@/dominio/cronograma';
import {
  ETIQUETA_MODALIDAD,
  REGLAS_SIN_PENALIZACION,
  type Condiciones,
  type Modalidad,
} from '@/dominio/tipos';
import {
  desdeTexto,
  esPositivo,
  formatear,
  tasaDesdePorcentaje,
  type Moneda,
  type PeriodoTasa,
} from '@/nucleo/dinero';
import {
  ahora,
  formatearDiaCorto,
  hoy,
  vencimientoDePeriodo,
  type Dia,
  type Frecuencia,
} from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';
import { desembolsar } from '@/servicios/desembolsar';
import { devengar } from '@/servicios/devengar';

const MODALIDADES: Modalidad[] = [
  'solo_interes',
  'cuota_fija',
  'interes_flat',
  'capital_fijo',
  'pago_unico',
];

const PERIODO_DE_FRECUENCIA: Record<Frecuencia, PeriodoTasa> = {
  diaria: 'diario',
  semanal: 'semanal',
  quincenal: 'quincenal',
  mensual: 'mensual',
};

const NOMBRE_FRECUENCIA: Record<Frecuencia, string> = {
  diaria: 'días',
  semanal: 'semanas',
  quincenal: 'quincenas',
  mensual: 'meses',
};

export default function PantallaNuevoPrestamo() {
  const { db, refrescar } = useBase();
  const tema = useTheme();
  const parametros = useLocalSearchParams<{ clienteId?: string }>();
  const hoyDia = hoy();

  const [clienteId, setClienteId] = useState<number | null>(
    parametros.clienteId ? Number(parametros.clienteId) : null,
  );
  const [moneda, setMoneda] = useState<Moneda>('BOB');
  const [capitalTexto, setCapitalTexto] = useState('');
  const [tasaTexto, setTasaTexto] = useState('10');
  // 'total' = el porcentaje es de todo el préstamo, repartido en las cuotas.
  const [periodoTasa, setPeriodoTasa] = useState<PeriodoTasa | 'total'>('mensual');
  const [modalidad, setModalidad] = useState<Modalidad>('solo_interes');
  const [frecuencia, setFrecuencia] = useState<Frecuencia>('mensual');
  const [plazoTexto, setPlazoTexto] = useState('6');
  const [capitalConFecha, setCapitalConFecha] = useState(true);
  // La fecha de entrega arranca en hoy; se cambia para cargar préstamos ya entregados.
  const [entrega, setEntrega] = useState<Dia>(hoyDia);
  // Por defecto no se cobra penalización: el usuario la activa préstamo por préstamo.
  const [conPenalizacion, setConPenalizacion] = useState(false);
  const [notas, setNotas] = useState('');
  const [masOpciones, setMasOpciones] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const clientes = useConsulta((base) => listarClientes(base));
  const esAbierto = modalidad === 'solo_interes';
  const permiteTasaTotal = modalidad === 'interes_flat' || modalidad === 'pago_unico';
  const sinFecha = esAbierto && !capitalConFecha;
  // Sin fecha de capital no hay plazo que pedir: la proyección muestra un solo período.
  const plazo = sinFecha ? 1 : Number(plazoTexto);

  const dia = entrega;

  const condiciones = useMemo<Condiciones | null>(() => {
    try {
      const capital = desdeTexto(capitalTexto, moneda);
      if (!esPositivo(capital)) return null;

      const porcentaje = Number(tasaTexto.replace(',', '.'));
      if (!Number.isFinite(porcentaje) || porcentaje < 0) return null;
      if (!Number.isInteger(plazo) || plazo < 1) return null;

      const ultimoVencimiento = vencimientoDePeriodo(dia, frecuencia, plazo);
      return {
        capital,
        tasa:
          periodoTasa === 'total'
            ? tasaDesdePorcentaje(porcentaje / plazo, PERIODO_DE_FRECUENCIA[frecuencia])
            : tasaDesdePorcentaje(porcentaje, periodoTasa),
        modalidad,
        frecuencia,
        cantidadPeriodos: esAbierto ? null : plazo,
        fechaDesembolso: dia,
        vencimientoCapital: !esAbierto || capitalConFecha ? ultimoVencimiento : null,
      };
    } catch {
      return null;
    }
  }, [
    capitalTexto,
    moneda,
    tasaTexto,
    periodoTasa,
    modalidad,
    frecuencia,
    plazo,
    dia,
    esAbierto,
    capitalConFecha,
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

  const desembolsarAhora = async () => {
    if (!clienteId || !condiciones) return;
    setGuardando(true);
    try {
      const reglasMora = conPenalizacion
        ? reglasMoraDe(await leerConfiguracion(db))
        : REGLAS_SIN_PENALIZACION;
      await enTransaccion(db, async () => {
        await desembolsar(db, { clienteId, condiciones, reglasMora, notas, ahora: ahora() });
        // Si la entrega es de una fecha pasada, el interés ya vencido aparece al instante.
        await devengar(db, { hoy: hoyDia, ahora: ahora() });
      });
      refrescar();
      router.replace({ pathname: '/cliente/[id]', params: { id: clienteId } });
    } catch (problema) {
      Alert.alert(
        'No se pudo registrar',
        problema instanceof Error ? problema.message : String(problema),
      );
    } finally {
      setGuardando(false);
    }
  };

  if (clientes.cargando && clientes.datos === null) {
    return (
      <Pantalla>
        <Cargando />
      </Pantalla>
    );
  }

  if ((clientes.datos ?? []).length === 0) {
    return (
      <Pantalla>
        <Vacio
          titulo="Primero cargá un cliente"
        />
        <Boton
          titulo="Nuevo cliente"
          icono="person-add"
          onPress={() => router.replace('/cliente/nuevo')}
        />
      </Pantalla>
    );
  }

  const elegido = (clientes.datos ?? []).find((cliente) => cliente.id === clienteId);

  return (
    <Pantalla>
      {clienteId === null ? (
        <Seccion titulo="¿A quién le prestás?">
          {(clientes.datos ?? []).map((cliente) => (
            <Tarjeta key={cliente.id} onPress={() => setClienteId(cliente.id)}>
              <Texto variante="subtitulo">{cliente.nombre}</Texto>
              {cliente.telefono ? (
                <Texto variante="suave" suave>
                  {cliente.telefono}
                </Texto>
              ) : null}
            </Tarjeta>
          ))}
        </Seccion>
      ) : (
        <Tarjeta onPress={() => setClienteId(null)}>
          <Texto variante="etiqueta" suave>
            Cliente
          </Texto>
          <Fila separado>
            <Texto variante="subtitulo">{elegido?.nombre ?? '—'}</Texto>
            <Texto variante="suave" suave>
              cambiar
            </Texto>
          </Fila>
        </Tarjeta>
      )}

      {clienteId === null ? null : (
        <>
          <Seccion titulo="Préstamo">
            <Opciones
              etiqueta="Moneda"
              valor={moneda}
              onChange={setMoneda}
              opciones={[
                { valor: 'BOB', titulo: 'Bolivianos' },
                { valor: 'USD', titulo: 'Dólares' },
              ]}
            />
            <Campo
              etiqueta="Monto"
              valor={capitalTexto}
              onChange={setCapitalTexto}
              placeholder="6000"
              teclado="decimal-pad"
              autoFocus
            />
            <Campo
              etiqueta="Interés (%)"
              valor={tasaTexto}
              onChange={setTasaTexto}
              teclado="decimal-pad"
            />
            <Opciones
              etiqueta="Ese porcentaje es"
              valor={periodoTasa}
              onChange={setPeriodoTasa}
              opciones={[
                ...(permiteTasaTotal ? [{ valor: 'total' as const, titulo: 'Del total' }] : []),
                { valor: 'mensual', titulo: 'Por mes' },
                { valor: 'quincenal', titulo: 'Por quincena' },
                { valor: 'semanal', titulo: 'Por semana' },
              ]}
            />
          </Seccion>

          <Seccion titulo="Forma de pago">
            <Opciones
              etiqueta="Tipo"
              valor={modalidad}
              onChange={(nueva) => {
                setModalidad(nueva);
                // "10% del préstamo" solo tiene sentido con interés sobre lo prestado o pago único.
                if (nueva === 'interes_flat' || nueva === 'pago_unico') setPeriodoTasa('total');
                else if (periodoTasa === 'total') setPeriodoTasa('mensual');
              }}
              opciones={MODALIDADES.map((valor) => ({
                valor,
                titulo: ETIQUETA_MODALIDAD[valor],
              }))}
            />
            <Opciones
              etiqueta="Paga cada"
              valor={frecuencia}
              onChange={setFrecuencia}
              opciones={[
                { valor: 'diaria', titulo: 'Día' },
                { valor: 'semanal', titulo: 'Semana' },
                { valor: 'quincenal', titulo: 'Quincena' },
                { valor: 'mensual', titulo: 'Mes' },
              ]}
            />
            {sinFecha ? null : (
              <Campo
                etiqueta={
                  esAbierto
                    ? `Devuelve el capital en (${NOMBRE_FRECUENCIA[frecuencia]})`
                    : `Cuotas`
                }
                valor={plazoTexto}
                onChange={(valor) => setPlazoTexto(valor.replace(/\D/g, ''))}
                teclado="numeric"
              />
            )}

            {esAbierto ? (
              <Opciones
                etiqueta="Fecha para el capital"
                valor={capitalConFecha ? 'con' : 'sin'}
                onChange={(valor) => setCapitalConFecha(valor === 'con')}
                opciones={[
                  { valor: 'con', titulo: 'Con fecha' },
                  { valor: 'sin', titulo: 'Sin fecha' },
                ]}
              />
            ) : null}
          </Seccion>

          {vista ? (
            <TarjetaDestacada>
              {esAbierto ? (
                <>
                  <Texto variante="etiqueta" color={tema.alDia}>
                    Interés por {NOMBRE_FRECUENCIA[frecuencia].slice(0, -1)}
                  </Texto>
                  <Monto valor={vista.lineas[0].interes} variante="titulo" />
                  <Dato etiqueta="Capital">
                    <Monto valor={condiciones!.capital} />
                  </Dato>
                  {sinFecha ? null : (
                    <>
                      <Dato etiqueta={`Ganás en ${plazo} ${NOMBRE_FRECUENCIA[frecuencia]}`}>
                        <Monto valor={vista.resumen.totalInteres} color={tema.alDia} />
                      </Dato>
                      <Dato etiqueta="Te devuelve">
                        <Monto valor={vista.resumen.totalAPagar} variante="subtitulo" />
                      </Dato>
                    </>
                  )}
                  {capitalConFecha ? (
                    <Dato etiqueta="Capital vence">
                      <Texto>
                        {formatearDiaCorto(vista.lineas[vista.lineas.length - 1].vencimiento)}
                      </Texto>
                    </Dato>
                  ) : null}
                </>
              ) : (
                <>
                  <Texto variante="etiqueta" color={tema.alDia}>
                    {vista.lineas.length === 1 ? 'Un pago de' : `${vista.lineas.length} cuotas de`}
                  </Texto>
                  <Monto valor={vista.resumen.cuotaMaxima} variante="titulo" />
                  {vista.resumen.cuotaMinima.centavos !== vista.resumen.cuotaMaxima.centavos ? (
                    <Texto variante="suave" suave>
                      baja hasta {formatear(vista.resumen.cuotaMinima)}
                    </Texto>
                  ) : null}
                  <Dato etiqueta="Ganás">
                    <Monto valor={vista.resumen.totalInteres} color={tema.alDia} />
                  </Dato>
                  <Dato etiqueta="Te devuelve">
                    <Monto valor={vista.resumen.totalAPagar} variante="subtitulo" />
                  </Dato>
                  <Dato etiqueta="Última cuota">
                    <Texto>
                      {formatearDiaCorto(vista.lineas[vista.lineas.length - 1].vencimiento)}
                    </Texto>
                  </Dato>
                </>
              )}
            </TarjetaDestacada>
          ) : capitalTexto.trim() ? (
            <Aviso tono="peligro">Revisá el monto, la tasa y el plazo.</Aviso>
          ) : null}

          {masOpciones ? (
            <Seccion titulo="Más opciones">
              <CampoFecha
                etiqueta="Fecha de entrega"
                valor={entrega}
                onChange={setEntrega}
                maximo={hoyDia}
                hoy={hoyDia}
              />
              <Opciones
                etiqueta="Penalización por atraso"
                valor={conPenalizacion ? 'con' : 'sin'}
                onChange={(valor) => setConPenalizacion(valor === 'con')}
                opciones={[
                  { valor: 'sin', titulo: 'No' },
                  { valor: 'con', titulo: 'Sí' },
                ]}
              />
              <Campo
                etiqueta="Notas"
                valor={notas}
                onChange={setNotas}
                placeholder="Para qué era, qué se acordó"
                multilinea
              />
            </Seccion>
          ) : (
            <Boton
              titulo="Más opciones"
              icono="options-outline"
              variante="secundario"
              onPress={() => setMasOpciones(true)}
            />
          )}

          <Boton
            titulo="Registrar y entregar"
            icono="cash"
            cargando={guardando}
            deshabilitado={!condiciones}
            onPress={desembolsarAhora}
          />
        </>
      )}
    </Pantalla>
  );
}
