import { router } from 'expo-router';

import { FormularioCliente } from '@/components/formulario-cliente';
import { crearCliente } from '@/datos/repositorios/clientes';
import { ahora } from '@/nucleo/fechas';
import { useBase } from '@/hooks/use-base';

export default function PantallaNuevoCliente() {
  const { db, refrescar } = useBase();

  return (
    <FormularioCliente
      tituloBoton="Guardar cliente"
      alGuardar={async (datos) => {
        const clienteId = await crearCliente(db, datos, ahora());
        refrescar();
        router.replace({ pathname: '/cliente/[id]', params: { id: clienteId } });
      }}
    />
  );
}
