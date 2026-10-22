/**
 * Los dos botones para mandar la copia de seguridad fuera del celular: a Drive o por
 * WhatsApp. Ambos abren el menú de Android para elegir la app; el título del menú dice cuál.
 * Al volver avisa con la fecha del día.
 */

import { useState } from 'react';
import { Alert } from 'react-native';

import { Boton } from '@/components/ui';
import { guardarCopiaAfuera } from '@/datos/respaldo';
import { ahora, formatearDiaCorto, hoy } from '@/nucleo/fechas';
import { useBase } from '@/hooks/use-base';

export function BotonesGuardarCopia({ alGuardar }: { alGuardar: () => void }) {
  const { db, refrescar } = useBase();
  const [trabajando, setTrabajando] = useState<'drive' | 'whatsapp' | null>(null);

  const guardar = async (destino: 'drive' | 'whatsapp') => {
    setTrabajando(destino);
    const dia = hoy();
    try {
      const listo = await guardarCopiaAfuera(db, {
        hoy: dia,
        ahora: ahora(),
        titulo:
          destino === 'drive'
            ? 'Elegí Drive para guardar la copia'
            : 'Elegí WhatsApp y mandátela a vos mismo',
      });
      if (listo) {
        Alert.alert('✅ Copia guardada', formatearDiaCorto(dia));
      } else {
        Alert.alert('No se pudo abrir el menú para compartir');
      }
      refrescar();
      alGuardar();
    } catch (problema) {
      Alert.alert('No se pudo', problema instanceof Error ? problema.message : String(problema));
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <>
      <Boton
        titulo="Guardar en Drive"
        icono="cloud-upload"
        cargando={trabajando === 'drive'}
        onPress={() => void guardar('drive')}
      />
      <Boton
        titulo="Enviar por WhatsApp"
        icono="logo-whatsapp"
        variante="secundario"
        cargando={trabajando === 'whatsapp'}
        onPress={() => void guardar('whatsapp')}
      />
    </>
  );
}
