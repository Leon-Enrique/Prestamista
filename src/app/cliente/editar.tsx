import { router, useLocalSearchParams } from 'expo-router';

import { FormularioCliente } from '@/components/formulario-cliente';
import { Cargando, Pantalla, Vacio } from '@/components/ui';
import { actualizarCliente, obtenerCliente } from '@/datos/repositorios/clientes';
import { ahora } from '@/nucleo/fechas';
import { useBase, useConsulta } from '@/hooks/use-base';

export default function PantallaEditarCliente() {
  const { db, refrescar } = useBase();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clienteId = Number(id);

  const cliente = useConsulta((base) => obtenerCliente(base, clienteId), [clienteId]);

  if (cliente.cargando && cliente.datos === null) {
    return (
      <Pantalla>
        <Cargando />
      </Pantalla>
    );
  }

  if (!cliente.datos) {
    return (
      <Pantalla>
        <Vacio titulo="No se encontró el cliente" />
      </Pantalla>
    );
  }

  return (
    <FormularioCliente
      inicial={cliente.datos}
      tituloBoton="Guardar cambios"
      alGuardar={async (datos) => {
        await actualizarCliente(db, clienteId, datos, ahora());
        refrescar();
        router.back();
      }}
    />
  );
}
