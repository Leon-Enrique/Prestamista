/**
 * Caja: cuánta plata hay en la mano, y lo que entró y salió.
 *
 * Solo el efectivo pasa por acá. Una transferencia queda en el libro pero no en la caja,
 * porque no está en el bolsillo y haría que el arqueo nunca cuadre.
 */

import type { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import {
  Boton,
  BotonRedondo,
  Campo,
  Cargando,
  FilaActividad,
  Fila,
  Monto,
  Opciones,
  Paginador,
  PantallaPrincipal,
  Seccion,
  Tarjeta,
  TarjetaDestacada,
  Texto,
} from '@/components/ui';
import { enTransaccion } from '@/datos/base';
import {
  cajaIniciada,
  contarMovimientosDeCaja,
  saldoDeCaja,
  ultimosMovimientosDeCaja,
} from '@/datos/consultas';
import {
  desdeTexto,
  esNegativo,
  esPositivo,
  negar,
  nombreMoneda,
  type Moneda,
} from '@/nucleo/dinero';
import { ahora, formatearDiaCorto, hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';
import { registrarManual } from '@/servicios/caja';

const POR_PAGINA = 10;

const TIPO: Record<string, { etiqueta: string; icono: keyof typeof Ionicons.glyphMap }> = {
  cobro: { etiqueta: 'Cobro', icono: 'arrow-down' },
  desembolso: { etiqueta: 'Préstamo entregado', icono: 'arrow-up' },
  retiro: { etiqueta: 'Retiro personal', icono: 'wallet-outline' },
  aporte: { etiqueta: 'Aporte de capital', icono: 'add' },
  gasto: { etiqueta: 'Gasto', icono: 'receipt-outline' },
  ajuste: { etiqueta: 'Ajuste de arqueo', icono: 'calculator-outline' },
};

export default function PantallaCaja() {
  const tema = useTheme();
  const { refrescar } = useBase();

  const saldos = useConsulta((db) => saldoDeCaja(db));
  const iniciada = useConsulta((db) => cajaIniciada(db));
  const [pagina, setPagina] = useState(0);
  const movimientos = useConsulta(
    (db) => ultimosMovimientosDeCaja(db, POR_PAGINA, pagina * POR_PAGINA),
    [pagina],
  );
  const cantidad = useConsulta((db) => contarMovimientosDeCaja(db));
  const totalPaginas = Math.ceil((cantidad.datos ?? 0) / POR_PAGINA);

  useFocusEffect(useCallback(() => refrescar(), [refrescar]));

  const conSaldo = saldos.datos ?? [];
  const lista = movimientos.datos ?? [];

  return (
    <PantallaPrincipal
      titulo="Caja"
      subtitulo="Efectivo en mano"
      derecha={
        <BotonRedondo
          icono="add"
          etiqueta="Anotar movimiento"
          onPress={() => router.push('/caja-movimiento')}
        />
      }>
      {saldos.cargando && saldos.datos === null ? <Cargando /> : null}

      {iniciada.datos === false ? <CajaInicial alGuardar={iniciada.recargar} /> : null}

      {conSaldo.map((saldo) => (
        <TarjetaDestacada key={saldo.moneda}>
          <Texto variante="etiqueta" color={esNegativo(saldo) ? tema.vencido : tema.alDia}>
            Tenés en {nombreMoneda(saldo.moneda).toLowerCase()}
          </Texto>
          <Monto
            valor={saldo}
            variante="titulo"
            color={esNegativo(saldo) ? tema.vencido : undefined}
          />
        </TarjetaDestacada>
      ))}

      <Fila>
        <Boton
          titulo="Anotar"
          icono="add-circle"
          onPress={() => router.push('/caja-movimiento')}
          style={{ flex: 1 }}
        />
        <Boton
          titulo="Contar"
          icono="calculator"
          variante="secundario"
          onPress={() => router.push('/caja-arqueo')}
          style={{ flex: 1 }}
        />
      </Fila>

      {lista.length > 0 ? (
        <Seccion titulo="Movimientos">
          <Tarjeta>
            {lista.map((movimiento) => {
              const entra = !esNegativo(movimiento.monto);
              // Un "desembolso" que entra es la devolución de un préstamo anulado.
              const tipo =
                movimiento.tipo === 'desembolso' && entra
                  ? { etiqueta: 'Préstamo anulado', icono: 'arrow-undo' as const }
                  : (TIPO[movimiento.tipo] ?? {
                      etiqueta: movimiento.tipo,
                      icono: 'swap-vertical' as const,
                    });
              return (
                <FilaActividad
                  key={movimiento.id}
                  icono={tipo.icono}
                  color={entra ? tema.alDia : tema.textSecondary}
                  titulo={tipo.etiqueta}
                  detalle={
                    formatearDiaCorto(movimiento.fecha) +
                    (movimiento.detalle ? ` · ${movimiento.detalle}` : '')
                  }
                  monto={entra ? movimiento.monto : negar(movimiento.monto)}
                  entra={entra}
                />
              );
            })}
            <Paginador pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />
          </Tarjeta>
        </Seccion>
      ) : null}
    </PantallaPrincipal>
  );
}

/** La primera vez: con cuánta plata empezás. Sin esto, el primer préstamo deja la caja en negativo. */
function CajaInicial({ alGuardar }: { alGuardar: () => void }) {
  const tema = useTheme();
  const { db, refrescar } = useBase();
  const [moneda, setMoneda] = useState<Moneda>('BOB');
  const [montoTexto, setMontoTexto] = useState('');
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    let monto;
    try {
      monto = desdeTexto(montoTexto, moneda);
    } catch {
      monto = null;
    }
    if (!monto || !esPositivo(monto)) {
      Alert.alert('Falta el monto', 'Escribí con cuánta plata empezás.');
      return;
    }
    setGuardando(true);
    try {
      await enTransaccion(db, () =>
        registrarManual(db, {
          tipo: 'aporte',
          monto,
          fecha: hoy(),
          detalle: 'Capital inicial',
          ahora: ahora(),
        }),
      );
      refrescar();
      alGuardar();
    } catch (problema) {
      Alert.alert('No se pudo', problema instanceof Error ? problema.message : String(problema));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <TarjetaDestacada>
      <Texto variante="etiqueta" color={tema.primario}>
        Para empezar
      </Texto>
      <Texto variante="subtitulo">¿Con cuánta plata empezás a prestar?</Texto>
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
        placeholder="10000"
        teclado="decimal-pad"
      />
      <Boton titulo="Guardar" icono="checkmark-circle" cargando={guardando} onPress={guardar} />
    </TarjetaDestacada>
  );
}
