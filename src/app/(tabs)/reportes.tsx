/**
 * Reportes: de lo que cobraste en un período, cuánto es ganancia y cuánto es plata que vuelve.
 * Primero el total, y después **cliente por cliente**: quién te pagó, cuánto, y de eso cuánto
 * fue interés y cuánto capital.
 *
 * El interés y la penalización son ganancia. El capital cobrado no: es recuperar lo que
 * prestaste. Mezclarlos hace creer que se ganó más de lo que se ganó.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { textoReparto } from '@/components/desglose-de-cobro';
import {
  Avatar,
  Cargando,
  CuadroIcono,
  Fila,
  Monto,
  Opciones,
  PantallaPrincipal,
  Seccion,
  Tarjeta,
  TarjetaDestacada,
  Texto,
  Vacio,
} from '@/components/ui';
import { cobradoEnPeriodo, cobrosDetallados, type CobroDetallado } from '@/datos/consultas';
import { esPositivo, formatear, nombreMoneda, sumar, type Dinero } from '@/nucleo/dinero';
import { armarDia, formatearDiaCorto, hoy, sumarMeses, type Dia } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';

type Periodo = 'este_mes' | 'mes_pasado' | 'este_anio' | 'todo';

function restarUnDia(d: Dia): Dia {
  const fecha = new Date(`${d}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().slice(0, 10) as Dia;
}

function rangoDe(periodo: Periodo, dia: Dia): { desde: Dia; hasta: Dia; titulo: string } {
  const anio = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7));
  if (periodo === 'todo') {
    return { desde: armarDia(2000, 1, 1), hasta: dia, titulo: 'Desde el inicio' };
  }
  if (periodo === 'este_anio') {
    return { desde: armarDia(anio, 1, 1), hasta: armarDia(anio, 12, 31), titulo: `Año ${anio}` };
  }
  const primero = armarDia(anio, mes, 1);
  const inicio = periodo === 'este_mes' ? primero : sumarMeses(primero, -1);
  const siguiente = sumarMeses(inicio, 1);
  return {
    desde: inicio,
    hasta: restarUnDia(siguiente),
    titulo: periodo === 'este_mes' ? 'Este mes' : 'Mes pasado',
  };
}

type PorCliente = {
  readonly clave: string;
  readonly clienteNombre: string;
  readonly cobrado: Dinero;
  readonly ganancia: Dinero;
  readonly capital: Dinero;
  readonly cobros: CobroDetallado[];
};

/** Junta los cobros de cada cliente (y moneda: bolivianos y dólares no se suman). */
function agruparPorCliente(cobros: readonly CobroDetallado[]): PorCliente[] {
  const grupos = new Map<string, CobroDetallado[]>();
  for (const cobro of cobros) {
    const clave = `${cobro.clienteId}-${cobro.monto.moneda}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), cobro]);
  }

  return [...grupos.entries()]
    .map(([clave, lista]) => ({
      clave,
      clienteNombre: lista[0].clienteNombre,
      cobrado: sumar(...lista.map((c) => c.monto)),
      ganancia: sumar(...lista.flatMap((c) => [c.interes, c.penalizacion])),
      capital: sumar(...lista.map((c) => c.capital)),
      cobros: lista,
    }))
    .sort((a, b) => b.ganancia.centavos - a.ganancia.centavos);
}

export default function PantallaReportes() {
  const tema = useTheme();
  const { refrescar } = useBase();
  const [periodo, setPeriodo] = useState<Periodo>('este_mes');
  const [abierto, setAbierto] = useState<string | null>(null);
  const rango = rangoDe(periodo, hoy());

  const totales = useConsulta((db) => cobradoEnPeriodo(db, rango.desde, rango.hasta), [
    rango.desde,
    rango.hasta,
  ]);
  const cobros = useConsulta(
    (db) => cobrosDetallados(db, { desde: rango.desde, hasta: rango.hasta, sinAnulados: true }),
    [rango.desde, rango.hasta],
  );

  useFocusEffect(useCallback(() => refrescar(), [refrescar]));

  const clientes = agruparPorCliente(cobros.datos ?? []);
  const varias = (totales.datos ?? []).length > 1;

  return (
    <PantallaPrincipal titulo="Reportes" subtitulo={rango.titulo}>
      <Opciones
        etiqueta="Período"
        valor={periodo}
        onChange={setPeriodo}
        opciones={[
          { valor: 'este_mes', titulo: 'Este mes' },
          { valor: 'mes_pasado', titulo: 'Mes pasado' },
          { valor: 'este_anio', titulo: 'Este año' },
          { valor: 'todo', titulo: 'Todo' },
        ]}
      />

      {totales.cargando && totales.datos === null ? <Cargando /> : null}

      {totales.datos !== null && totales.datos.length === 0 ? (
        <Vacio titulo="Sin cobros en este período" />
      ) : null}

      {(totales.datos ?? []).map((fila) => (
        <View key={fila.moneda} style={styles.bloque}>
          <TarjetaDestacada>
            <Texto variante="etiqueta" color={tema.alDia}>
              Ganancia{varias ? ` · ${nombreMoneda(fila.moneda).toLowerCase()}` : ''}
            </Texto>
            <Monto valor={sumar(fila.interes, fila.penalizacion)} variante="titulo" />
            <Texto variante="suave" suave>
              {`${fila.cantidadDePagos} ${fila.cantidadDePagos === 1 ? 'cobro' : 'cobros'}`}
              {esPositivo(fila.penalizacion)
                ? ` · ${formatear(fila.penalizacion)} de penalización`
                : ''}
            </Texto>
          </TarjetaDestacada>

          <Tarjeta>
            <Fila>
              <CuadroIcono
                icono="cash"
                color={tema.primario}
                etiqueta="Te pagaron"
                valor={formatear(sumar(fila.interes, fila.penalizacion, fila.capital))}
              />
              <View style={[styles.divisor, { backgroundColor: tema.borde }]} />
              <CuadroIcono
                icono="arrow-undo"
                color={tema.alDia}
                etiqueta="Capital que volvió"
                valor={formatear(fila.capital)}
              />
            </Fila>
          </Tarjeta>
        </View>
      ))}

      {clientes.length > 0 ? (
        <Seccion titulo="Por cliente">
          {clientes.map((cliente) => {
            const expandido = abierto === cliente.clave;
            return (
              <Tarjeta
                key={cliente.clave}
                onPress={() => setAbierto(expandido ? null : cliente.clave)}>
                <Fila>
                  <Avatar nombre={cliente.clienteNombre} />
                  <View style={styles.texto}>
                    <Texto variante="subtitulo" numberOfLines={1}>
                      {cliente.clienteNombre}
                    </Texto>
                    <Texto variante="suave" suave numberOfLines={1}>
                      Te pagó {formatear(cliente.cobrado)} · {cliente.cobros.length}{' '}
                      {cliente.cobros.length === 1 ? 'cobro' : 'cobros'}
                    </Texto>
                  </View>
                  <View style={styles.derecha}>
                    <Texto variante="subtitulo" color={tema.alDia} style={styles.tabular}>
                      +{formatear(cliente.ganancia)}
                    </Texto>
                    <Ionicons
                      name={expandido ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={tema.textSecondary}
                    />
                  </View>
                </Fila>

                {expandido
                  ? cliente.cobros.map((cobro) => (
                      <View
                        key={cobro.pagoId}
                        style={[styles.cobro, { borderTopColor: tema.borde }]}>
                        <Fila separado>
                          <Texto>{formatearDiaCorto(cobro.fecha)}</Texto>
                          <Monto valor={cobro.monto} variante="subtitulo" />
                        </Fila>
                        <Texto variante="suave" suave>
                          {textoReparto(cobro)}
                        </Texto>
                      </View>
                    ))
                  : null}
              </Tarjeta>
            );
          })}
        </Seccion>
      ) : null}
    </PantallaPrincipal>
  );
}

const styles = StyleSheet.create({
  bloque: { gap: 16 },
  divisor: { alignSelf: 'stretch', width: StyleSheet.hairlineWidth },
  texto: { flex: 1, gap: 2 },
  derecha: { alignItems: 'flex-end', gap: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
  cobro: { borderTopWidth: StyleSheet.hairlineWidth, gap: 2, paddingTop: 8 },
});
