/**
 * Caja: cuánta plata hay en la mano, y lo que entró y salió.
 *
 * Solo el efectivo pasa por acá. Una transferencia queda en el libro pero no en la caja,
 * porque no está en el bolsillo y haría que el arqueo nunca cuadre.
 */

import type { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import {
  Boton,
  BotonRedondo,
  Cargando,
  FilaActividad,
  Fila,
  Monto,
  PantallaPrincipal,
  Seccion,
  Tarjeta,
  TarjetaDestacada,
  Texto,
  Vacio,
} from '@/components/ui';
import { saldoDeCaja, ultimosMovimientosDeCaja } from '@/datos/consultas';
import { esNegativo, negar, nombreMoneda } from '@/nucleo/dinero';
import { formatearDiaCorto } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';

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
  const movimientos = useConsulta((db) => ultimosMovimientosDeCaja(db));

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

      {saldos.datos !== null && conSaldo.length === 0 ? (
        <Vacio titulo="Sin movimientos de caja" />
      ) : null}

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
              const tipo = TIPO[movimiento.tipo] ?? {
                etiqueta: movimiento.tipo,
                icono: 'swap-vertical' as const,
              };
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
          </Tarjeta>
        </Seccion>
      ) : null}
    </PantallaPrincipal>
  );
}
