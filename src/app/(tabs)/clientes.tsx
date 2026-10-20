/**
 * Clientes: la lista con lo que debe cada uno, y un buscador por nombre, carnet o teléfono.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Avatar,
  BotonRedondo,
  Campo,
  Cargando,
  Fila,
  Insignia,
  PantallaPrincipal,
  Tarjeta,
  Texto,
  Vacio,
} from '@/components/ui';
import { deudaPorCliente } from '@/datos/consultas';
import { listarClientes } from '@/datos/repositorios/clientes';
import { formatear } from '@/nucleo/dinero';
import { hoy } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';
import { useTheme } from '@/hooks/use-theme';

export default function PantallaClientes() {
  const tema = useTheme();
  const { refrescar } = useBase();
  const [busqueda, setBusqueda] = useState('');
  const dia = hoy();

  const clientes = useConsulta((db) => listarClientes(db, { busqueda }), [busqueda]);
  const deudas = useConsulta((db) => deudaPorCliente(db, dia), [dia]);

  useFocusEffect(useCallback(() => refrescar(), [refrescar]));

  const lista = clientes.datos ?? [];
  const conDeuda = lista.filter((c) => deudas.datos?.has(c.id)).length;

  return (
    <PantallaPrincipal
      titulo="Clientes"
      subtitulo={
        clientes.datos === null
          ? undefined
          : `${lista.length} ${lista.length === 1 ? 'cliente' : 'clientes'} · ${conDeuda} con deuda`
      }
      derecha={
        <BotonRedondo
          icono="person-add"
          etiqueta="Nuevo cliente"
          onPress={() => router.push('/cliente/nuevo')}
        />
      }>
      <Campo
        etiqueta="Buscar"
        valor={busqueda}
        onChange={setBusqueda}
        placeholder="Nombre, carnet o teléfono"
      />

      {clientes.cargando && clientes.datos === null ? <Cargando /> : null}

      {clientes.datos?.length === 0 ? (
        <Vacio titulo={busqueda ? 'Nadie con ese dato' : 'Todavía no hay clientes'} />
      ) : null}

      {lista.map((cliente) => {
        const deuda = deudas.datos?.get(cliente.id);
        return (
          <Tarjeta
            key={cliente.id}
            acento={deuda ? (deuda.atrasado ? tema.vencido : tema.alDia) : undefined}
            onPress={() => router.push({ pathname: '/cliente/[id]', params: { id: cliente.id } })}>
            <Fila>
              <Avatar nombre={cliente.nombre} />
              <View style={styles.texto}>
                <Texto variante="subtitulo" numberOfLines={1}>
                  {cliente.nombre}
                </Texto>
                <Texto variante="suave" suave numberOfLines={1}>
                  {[cliente.telefono, cliente.ci && `CI ${cliente.ci}`].filter(Boolean).join(' · ') ||
                    'Sin datos de contacto'}
                </Texto>
              </View>
              <View style={styles.derecha}>
                {deuda ? (
                  <>
                    <Texto variante="subtitulo" style={styles.tabular}>
                      {deuda.saldos.map((s) => formatear(s)).join(' · ')}
                    </Texto>
                    {deuda.atrasado ? (
                      <Insignia texto="Atrasado" color={tema.vencido} fondo={tema.vencidoSuave} />
                    ) : null}
                  </>
                ) : (
                  <Insignia texto="Sin deuda" color={tema.alDia} fondo={tema.alDiaSuave} />
                )}
              </View>
            </Fila>
          </Tarjeta>
        );
      })}
    </PantallaPrincipal>
  );
}

const styles = StyleSheet.create({
  texto: { flex: 1, gap: 2 },
  derecha: { alignItems: 'flex-end', gap: 4 },
  tabular: { fontVariant: ['tabular-nums'] },
});
