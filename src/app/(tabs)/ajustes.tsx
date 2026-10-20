/**
 * Ajustes: respaldo, bloqueo y reglas del negocio.
 *
 * El respaldo va primero y no por casualidad: es lo único irreversible de toda la app. Un
 * celular perdido sin respaldo es la cartera entera perdida.
 */

import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import {
  Aviso,
  Boton,
  Campo,
  Dato,
  PantallaPrincipal,
  Seccion,
  Tarjeta,
  Texto,
  Opciones,
} from '@/components/ui';
import {
  diasSinRespaldoParaAvisarDe,
  escribirConfiguracion,
  leerConfiguracion,
  reglasMoraDe,
} from '@/datos/repositorios/config';
import {
  definirPin,
  hayBiometria,
  hayPinDefinido,
  LARGO_MINIMO_PIN,
  pinEsValido,
  quitarPin,
} from '@/datos/pin';
import {
  compartirRespaldo,
  diasSinRespaldo,
  elegirArchivoDeRespaldo,
  exportarCartera,
  listarRespaldos,
  revisarRespaldo,
  tomarRespaldo,
} from '@/datos/respaldo';
import { restaurarDesdeBytes } from '@/datos/restauracion';
import { ahora, hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';

export default function PantallaAjustes() {
  const { db, refrescar } = useBase();
  const dia = hoy();

  const estado = useConsulta(async (base) => {
    const configuracion = await leerConfiguracion(base);
    return {
      configuracion,
      mora: reglasMoraDe(configuracion),
      dias: diasSinRespaldo(configuracion, dia),
      limite: diasSinRespaldoParaAvisarDe(configuracion),
      conPin: await hayPinDefinido(),
      conBiometria: await hayBiometria(),
      respaldos: listarRespaldos(),
    };
  }, [dia]);

  const [trabajando, setTrabajando] = useState<string | null>(null);

  useFocusEffect(useCallback(() => refrescar(), [refrescar]));

  const conAviso = async (clave: string, tarea: () => Promise<string | null>) => {
    setTrabajando(clave);
    try {
      const mensaje = await tarea();
      if (mensaje) Alert.alert('Listo', mensaje);
    } catch (error) {
      Alert.alert('No se pudo', error instanceof Error ? error.message : String(error));
    } finally {
      setTrabajando(null);
      estado.recargar();
      refrescar();
    }
  };

  const respaldarYCompartir = () =>
    conAviso('respaldar', async () => {
      const respaldo = await tomarRespaldo(db, { ahora: ahora() });
      const compartido = await compartirRespaldo(respaldo);
      return compartido
        ? null
        : 'El respaldo quedó guardado en el celular, pero no se pudo abrir el menú para compartirlo.';
    });

  const exportar = () =>
    conAviso('exportar', async () => {
      await exportarCartera(db);
      return null;
    });

  const restaurar = () =>
    conAviso('restaurar', async () => {
      const elegido = await elegirArchivoDeRespaldo();
      if (!elegido) return null;

      const revision = await revisarRespaldo(elegido.bytes);
      if (!revision.valido) {
        throw new Error(revision.motivo ?? 'El archivo no sirve como respaldo.');
      }

      const confirmado = await new Promise<boolean>((resolver) => {
        Alert.alert(
          '¿Restaurar este respaldo?',
          `"${elegido.nombre}" tiene ${revision.clientes} clientes, ` +
            `${revision.prestamos} préstamos y ${revision.pagos} pagos.\n\n` +
            'Tu cartera actual se va a reemplazar por completo. Antes se guarda una copia ' +
            'de lo que tenés ahora, por si te equivocaste de archivo.',
          [
            { text: 'Cancelar', style: 'cancel', onPress: () => resolver(false) },
            { text: 'Restaurar', style: 'destructive', onPress: () => resolver(true) },
          ],
        );
      });
      if (!confirmado) return null;

      const resultado = await restaurarDesdeBytes(db, elegido.bytes, ahora());
      return (
        `Cartera restaurada: ${resultado.resultado.copiadas.clientes} clientes y ` +
        `${resultado.resultado.copiadas.prestamos} préstamos.\n\n` +
        `Lo que tenías antes quedó guardado como "${resultado.respaldoDeSeguridad.nombre}".`
      );
    });

  const datos = estado.datos;
  const sinRespaldo = datos && (datos.dias === null || datos.dias >= datos.limite);

  return (
    <PantallaPrincipal titulo="Ajustes">
      <Seccion titulo="Respaldo">
        {sinRespaldo ? (
          <Aviso tono="peligro" icono="cloud-offline">
            {datos.dias === null
              ? 'Sin respaldo.'
              : `Último respaldo hace ${datos.dias} días.`}
          </Aviso>
        ) : (
          <Aviso tono="bien" icono="shield-checkmark">
            Último respaldo hace {datos?.dias ?? 0} {datos?.dias === 1 ? 'día' : 'días'}.
          </Aviso>
        )}

        <Boton
          titulo="Respaldar y compartir"
          icono="cloud-upload"
          onPress={respaldarYCompartir}
          cargando={trabajando === 'respaldar'}
        />
        <Boton
          titulo="Exportar la cartera en planilla"
          icono="document-text"
          variante="secundario"
          onPress={exportar}
          cargando={trabajando === 'exportar'}
        />
        <Boton
          titulo="Restaurar un respaldo"
          icono="cloud-download"
          variante="secundario"
          onPress={restaurar}
          cargando={trabajando === 'restaurar'}
        />

        {(datos?.respaldos ?? []).length > 0 ? (
          <Tarjeta>
            <Texto variante="etiqueta" suave>
              Copias en este celular
            </Texto>
            {(datos?.respaldos ?? []).map((respaldo) => (
              <Dato key={respaldo.uri} etiqueta={respaldo.nombre}>
                <Texto variante="suave" suave>
                  {Math.max(1, Math.round(respaldo.bytes / 1024))} KB
                </Texto>
              </Dato>
            ))}
          </Tarjeta>
        ) : null}
      </Seccion>

      <SeccionPin
        conPin={datos?.conPin ?? false}
        conBiometria={datos?.conBiometria ?? false}
        alCambiar={estado.recargar}
      />

      {datos ? (
        <SeccionMora
          diasDeGracia={String(datos.mora.diasDeGracia)}
          puntosBasicos={String(datos.mora.puntosBasicosDiarios)}
          tope={String(datos.mora.topePuntosBasicos)}
          tipo={datos.mora.tipo}
          centavosDiarios={String(datos.mora.centavosDiarios)}
          alGuardar={async (cambios) => {
            const marca = ahora();
            for (const [clave, valor] of Object.entries(cambios)) {
              await escribirConfiguracion(db, clave, valor, marca);
            }
            estado.recargar();
            refrescar();
            Alert.alert('Listo', 'Reglas de penalización guardadas.');
          }}
        />
      ) : null}

      <Seccion titulo="Sobre la app">
        <Tarjeta>
          <Dato etiqueta="Versión">
            <Texto>{Constants.expoConfig?.version ?? '—'}</Texto>
          </Dato>
        </Tarjeta>
      </Seccion>
    </PantallaPrincipal>
  );
}

function SeccionPin({
  conPin,
  conBiometria,
  alCambiar,
}: {
  conPin: boolean;
  conBiometria: boolean;
  alCambiar: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!pinEsValido(pin)) {
      setError(`Tiene que ser de al menos ${LARGO_MINIMO_PIN} números.`);
      return;
    }
    try {
      await definirPin(pin);
      setPin('');
      setError(null);
      alCambiar();
      Alert.alert('Listo', 'El PIN se va a pedir la próxima vez que abras la app.');
    } catch (problema) {
      setError(problema instanceof Error ? problema.message : String(problema));
    }
  };

  const quitar = () => {
    Alert.alert('¿Quitar el PIN?', 'La app va a abrirse sin pedir nada.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: () => {
          void quitarPin().then(alCambiar);
        },
      },
    ]);
  };

  return (
    <Seccion titulo="Bloqueo">
      {conPin ? (
        <Aviso tono="bien" icono="lock-closed">
          PIN activado{conBiometria ? ' · huella' : ''}
        </Aviso>
      ) : (
        <Aviso icono="lock-open">Sin PIN</Aviso>
      )}

      <Campo
        etiqueta={conPin ? 'Cambiar el PIN' : 'Poner un PIN'}
        valor={pin}
        onChange={(valor) => {
          setPin(valor.replace(/\D/g, ''));
          setError(null);
        }}
        placeholder="Solo números"
        teclado="numeric"
        error={error}
      />
      <Boton titulo="Guardar PIN" icono="key" onPress={guardar} />
      {conPin ? (
        <Boton titulo="Quitar el PIN" variante="secundario" onPress={quitar} />
      ) : null}
    </Seccion>
  );
}

function SeccionMora({
  diasDeGracia,
  puntosBasicos,
  tope,
  tipo,
  centavosDiarios,
  alGuardar,
}: {
  diasDeGracia: string;
  puntosBasicos: string;
  tope: string;
  tipo: 'porcentaje_diario' | 'monto_fijo_diario';
  centavosDiarios: string;
  alGuardar: (cambios: Record<string, string>) => Promise<void>;
}) {
  const [forma, setForma] = useState(tipo);
  const [gracia, setGracia] = useState(diasDeGracia);
  const [porcentaje, setPorcentaje] = useState((Number(puntosBasicos) / 100).toString());
  const [fijo, setFijo] = useState((Number(centavosDiarios) / 100).toString());
  const [techo, setTecho] = useState((Number(tope) / 100).toString());

  return (
    <Seccion titulo="Penalización por atraso: cómo se calcula">
      <Opciones
        etiqueta="Forma"
        valor={forma}
        onChange={setForma}
        opciones={[
          { valor: 'porcentaje_diario', titulo: 'Porcentaje por día' },
          { valor: 'monto_fijo_diario', titulo: 'Monto fijo por día' },
        ]}
      />

      <Campo
        etiqueta="Días de gracia"
        valor={gracia}
        onChange={(valor) => setGracia(valor.replace(/\D/g, ''))}
        teclado="numeric"
      />

      {forma === 'porcentaje_diario' ? (
        <Campo
          etiqueta="Porcentaje diario sobre lo vencido"
          valor={porcentaje}
          onChange={setPorcentaje}
          teclado="decimal-pad"
        />
      ) : (
        <Campo
          etiqueta="Monto fijo por día"
          valor={fijo}
          onChange={setFijo}
          teclado="decimal-pad"
        />
      )}

      <Campo
        etiqueta="Techo de la penalización (% del monto vencido)"
        valor={techo}
        onChange={setTecho}
        teclado="decimal-pad"
      />

      <Boton
        titulo="Guardar reglas"
        icono="save"
        onPress={() =>
          void alGuardar({
            mora_tipo: forma,
            mora_dias_gracia: String(Math.max(0, Number(gracia) || 0)),
            mora_puntos_basicos_diarios: String(
              Math.max(0, Math.round((Number(porcentaje.replace(',', '.')) || 0) * 100)),
            ),
            mora_centavos_diarios: String(
              Math.max(0, Math.round((Number(fijo.replace(',', '.')) || 0) * 100)),
            ),
            mora_tope_puntos_basicos: String(
              Math.max(0, Math.round((Number(techo.replace(',', '.')) || 0) * 100)),
            ),
          })
        }
      />
    </Seccion>
  );
}
