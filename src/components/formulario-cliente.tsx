/**
 * Los datos de un cliente, para darlo de alta o corregirlo. Quien lo usa decide qué hacer al
 * guardar; el formulario solo pide el nombre como obligatorio.
 */

import { useState } from 'react';
import { Alert } from 'react-native';

import { Boton, Campo, Pantalla, Seccion } from '@/components/ui';
import type { DatosCliente } from '@/datos/repositorios/clientes';

export function FormularioCliente({
  inicial,
  tituloBoton,
  alGuardar,
}: {
  inicial?: DatosCliente;
  tituloBoton: string;
  alGuardar: (datos: DatosCliente) => Promise<void>;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [ci, setCi] = useState(inicial?.ci ?? '');
  const [telefono, setTelefono] = useState(inicial?.telefono ?? '');
  const [direccion, setDireccion] = useState(inicial?.direccion ?? '');
  const [referencias, setReferencias] = useState(inicial?.referencias ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (nombre.trim().length < 2) {
      setError('Poné al menos el nombre.');
      return;
    }
    setGuardando(true);
    try {
      await alGuardar({ nombre, ci, telefono, direccion, referencias, notas: inicial?.notas });
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
      <Seccion>
        <Campo
          etiqueta="Nombre"
          valor={nombre}
          onChange={(valor) => {
            setNombre(valor);
            setError(null);
          }}
          placeholder="Nombre y apellido"
          error={error}
          autoFocus={!inicial}
        />
        <Campo etiqueta="Carnet" valor={ci} onChange={setCi} placeholder="Opcional" teclado="numeric" />
        <Campo
          etiqueta="Teléfono"
          valor={telefono}
          onChange={setTelefono}
          placeholder="Opcional"
          teclado="phone-pad"
        />
        <Campo etiqueta="Dirección" valor={direccion} onChange={setDireccion} placeholder="Opcional" />
        <Campo
          etiqueta="Referencias"
          valor={referencias}
          onChange={setReferencias}
          placeholder="Quién lo recomendó, dónde trabaja, un contacto"
          multilinea
        />
      </Seccion>

      <Boton titulo={tituloBoton} icono="checkmark-circle" onPress={guardar} cargando={guardando} />
    </Pantalla>
  );
}
