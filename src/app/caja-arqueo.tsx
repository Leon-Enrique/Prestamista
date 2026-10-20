/**
 * Arqueo: contar el efectivo y comparar contra lo que dice la app.
 *
 * Si hay diferencia **no se corrige el pasado**: queda un ajuste con su monto y su motivo.
 * Editar movimientos viejos para que cuadre destruye lo único que hace útil al arqueo, que
 * es poder ver que hubo una diferencia y cuándo.
 */

import { router } from 'expo-router';
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
} from '@/components/ui';
import { enTransaccion } from '@/datos/base';
import { desdeTexto, formatear, negar, type Dinero, type Moneda } from '@/nucleo/dinero';
import { ahora, hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';
import { arquear, efectivoEsperado } from '@/servicios/caja';

export default function PantallaArqueo() {
  const tema = useTheme();
  const { db, refrescar } = useBase();
  const dia = hoy();

  const [moneda, setMoneda] = useState<Moneda>('BOB');
  const [contadoTexto, setContadoTexto] = useState('');
  const [detalle, setDetalle] = useState('');
  const [guardando, setGuardando] = useState(false);

  const esperado = useConsulta((base) => efectivoEsperado(base, moneda), [moneda]);

  const contado = useMemo<Dinero | null>(() => {
    if (!contadoTexto.trim()) return null;
    try {
      const valor = desdeTexto(contadoTexto, moneda);
      return valor.centavos < 0 ? null : valor;
    } catch {
      return null;
    }
  }, [contadoTexto, moneda]);

  const diferencia = useMemo<Dinero | null>(() => {
    if (!contado || !esperado.datos) return null;
    return { centavos: contado.centavos - esperado.datos.centavos, moneda };
  }, [contado, esperado.datos, moneda]);

  const confirmar = async () => {
    if (!contado) return;
    setGuardando(true);
    try {
      const resultado = await enTransaccion(db, () =>
        arquear(db, { moneda, contado, fecha: dia, detalle, ahora: ahora() }),
      );
      refrescar();

      Alert.alert(
        resultado.cuadro ? 'Cuadró' : 'Quedó registrada la diferencia',
        resultado.cuadro
          ? `Contaste ${formatear(resultado.contado)} y es exactamente lo que decía la app.`
          : `La app decía ${formatear(resultado.esperado)} y contaste ` +
            `${formatear(resultado.contado)}.\n\n` +
            `${resultado.diferencia.centavos > 0 ? 'Sobraban' : 'Faltaban'} ` +
            `${formatear(resultado.diferencia.centavos > 0 ? resultado.diferencia : negar(resultado.diferencia))}. ` +
            'Quedó un ajuste en la caja con el motivo.',
        [{ text: 'Listo', onPress: () => router.back() }],
      );
    } catch (problema) {
      Alert.alert(
        'No se pudo registrar',
        problema instanceof Error ? problema.message : String(problema),
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Pantalla>
      <Opciones
        etiqueta="Qué estás contando"
        valor={moneda}
        onChange={setMoneda}
        opciones={[
          { valor: 'BOB', titulo: 'Bolivianos' },
          { valor: 'USD', titulo: 'Dólares' },
        ]}
      />

      {esperado.cargando && esperado.datos === null ? (
        <Cargando />
      ) : (
        <Tarjeta>
          <Texto variante="suave" suave>
            Según la app tendrías que tener
          </Texto>
          <Monto valor={esperado.datos ?? { centavos: 0, moneda }} variante="titulo" />
        </Tarjeta>
      )}

      <Seccion titulo="Contá la plata">
        <Campo
          etiqueta="Cuánto contaste de verdad"
          valor={contadoTexto}
          onChange={setContadoTexto}
          placeholder="0"
          teclado="decimal-pad"
          autoFocus
        />
      </Seccion>

      {diferencia ? (
        diferencia.centavos === 0 ? (
          <Aviso tono="bien" icono="checkmark-circle">
            Cuadra exacto.
          </Aviso>
        ) : (
          <>
            <Tarjeta acento={tema.vencido}>
              <Dato etiqueta={diferencia.centavos > 0 ? 'Sobra' : 'Falta'}>
                <Monto
                  valor={diferencia.centavos > 0 ? diferencia : negar(diferencia)}
                  variante="subtitulo"
                  color={tema.vencido}
                />
              </Dato>
            </Tarjeta>
          </>
        )
      ) : null}

      <Campo
        etiqueta="Motivo o nota"
        valor={detalle}
        onChange={setDetalle}
        placeholder="Opcional: a qué le atribuís la diferencia"
        multilinea
      />

      <Boton
        titulo="Confirmar el arqueo"
        icono="calculator"
        onPress={confirmar}
        cargando={guardando}
        deshabilitado={!contado}
      />
    </Pantalla>
  );
}
