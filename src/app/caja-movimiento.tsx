/**
 * Anotar un movimiento de caja que no es un préstamo.
 *
 * Lo que sacás para vos, lo que ponés de tu bolsillo, un gasto. Sin esto la caja queda mal
 * para siempre y el arqueo deja de servir para detectar un error de verdad.
 */

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import {
  Aviso,
  Boton,
  Campo,
  Dato,
  Monto,
  Opciones,
  Pantalla,
  Seccion,
  Tarjeta,
} from '@/components/ui';
import { enTransaccion } from '@/datos/base';
import { desdeTexto, esPositivo, formatear, type Dinero, type Moneda } from '@/nucleo/dinero';
import { ahora, hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';
import {
  efectivoEsperado,
  ETIQUETA_TIPO_MANUAL,
  registrarManual,
  TIPOS_MANUALES,
  type TipoManual,
} from '@/servicios/caja';

export default function PantallaMovimientoDeCaja() {
  const tema = useTheme();
  const { db, refrescar } = useBase();
  const dia = hoy();

  const [tipo, setTipo] = useState<TipoManual>('retiro');
  const [moneda, setMoneda] = useState<Moneda>('BOB');
  const [montoTexto, setMontoTexto] = useState('');
  const [detalle, setDetalle] = useState('');
  const [guardando, setGuardando] = useState(false);

  const esperado = useConsulta((base) => efectivoEsperado(base, moneda), [moneda]);

  const monto = useMemo<Dinero | null>(() => {
    if (!montoTexto.trim()) return null;
    try {
      const valor = desdeTexto(montoTexto, moneda);
      return esPositivo(valor) ? valor : null;
    } catch {
      return null;
    }
  }, [montoTexto, moneda]);

  const quedaria = useMemo<Dinero | null>(() => {
    if (!monto || !esperado.datos) return null;
    const signo = tipo === 'aporte' ? 1 : -1;
    return { centavos: esperado.datos.centavos + signo * monto.centavos, moneda };
  }, [monto, esperado.datos, tipo, moneda]);

  const guardar = async () => {
    if (!monto) return;
    if (detalle.trim().length < 3) {
      Alert.alert('Falta el detalle', 'Escribí para qué fue: en dos meses no te vas a acordar.');
      return;
    }

    setGuardando(true);
    try {
      await enTransaccion(db, () =>
        registrarManual(db, { tipo, monto, fecha: dia, detalle, ahora: ahora() }),
      );
      refrescar();
      router.back();
    } catch (problema) {
      Alert.alert(
        'No se pudo guardar',
        problema instanceof Error ? problema.message : String(problema),
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Pantalla>
      <Seccion titulo="Qué pasó">
        <Opciones
          etiqueta="Movimiento"
          valor={tipo}
          onChange={setTipo}
          opciones={TIPOS_MANUALES.map((valor) => ({
            valor,
            titulo: ETIQUETA_TIPO_MANUAL[valor],
          }))}
        />
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
          valor={montoTexto}
          onChange={setMontoTexto}
          placeholder="0"
          teclado="decimal-pad"
          autoFocus
        />
        <Campo
          etiqueta="Para qué fue"
          valor={detalle}
          onChange={setDetalle}
          placeholder="Para la casa, pasajes, capital nuevo…"
          multilinea
        />
      </Seccion>

      {esperado.datos ? (
        <Seccion titulo="La caja">
          <Tarjeta>
            <Dato etiqueta="Tenés ahora">
              <Monto valor={esperado.datos} />
            </Dato>
            {quedaria ? (
              <Dato etiqueta="Quedaría en">
                <Monto
                  valor={quedaria}
                  variante="subtitulo"
                  color={quedaria.centavos < 0 ? tema.vencido : undefined}
                />
              </Dato>
            ) : null}
          </Tarjeta>

          {quedaria && quedaria.centavos < 0 ? (
            <Aviso tono="peligro">No alcanza: quedaría en {formatear(quedaria)}.</Aviso>
          ) : null}
        </Seccion>
      ) : null}

      <Boton
        titulo="Guardar movimiento"
        icono="save"
        onPress={guardar}
        cargando={guardando}
        deshabilitado={!monto}
      />
    </Pantalla>
  );
}
