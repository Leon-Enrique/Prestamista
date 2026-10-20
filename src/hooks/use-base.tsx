/**
 * La base de datos, disponible para toda la app.
 *
 * Al arrancar hace tres cosas, en este orden y antes de que se vea una sola pantalla:
 *
 * 1. Abre la base y aplica las migraciones pendientes.
 * 2. **Devenga** lo que el paso del tiempo generó: el interés de los períodos cumplidos y
 *    la mora de lo vencido. No hay servidor que lo haga de noche, así que se hace acá.
 * 3. Recién entonces muestra la cartera.
 *
 * El devengo es idempotente, así que abrir la app diez veces en un día no duplica nada.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { abrirBase, enTransaccion } from '@/datos/base';
import { ahora, hoy } from '@/nucleo/fechas';
import { devengar, type ResumenDevengo } from '@/servicios/devengar';

type EstadoBase =
  | { fase: 'cargando' }
  | { fase: 'error'; error: Error }
  | { fase: 'lista'; db: SQLiteDatabase; devengo: ResumenDevengo };

type ContextoBase = {
  readonly db: SQLiteDatabase;
  readonly devengo: ResumenDevengo;
  /** Sube un contador para que las pantallas vuelvan a consultar. */
  readonly refrescar: () => void;
  readonly version: number;
};

const Contexto = createContext<ContextoBase | null>(null);

export function ProveedorBase({
  children,
  alFallar,
  mientrasCarga,
}: {
  children: ReactNode;
  alFallar: (error: Error, reintentar: () => void) => ReactNode;
  mientrasCarga: ReactNode;
}) {
  const [estado, setEstado] = useState<EstadoBase>({ fase: 'cargando' });
  const [version, setVersion] = useState(0);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        const { db } = await abrirBase();
        const devengo = await enTransaccion(db, () =>
          devengar(db, { hoy: hoy(), ahora: ahora() }),
        );
        if (!cancelado) setEstado({ fase: 'lista', db, devengo });
      } catch (error) {
        if (!cancelado) {
          setEstado({ fase: 'error', error: error instanceof Error ? error : new Error(String(error)) });
        }
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [intento]);

  const refrescar = useCallback(() => setVersion((anterior) => anterior + 1), []);
  const reintentar = useCallback(() => {
    setEstado({ fase: 'cargando' });
    setIntento((anterior) => anterior + 1);
  }, []);

  if (estado.fase === 'cargando') return <>{mientrasCarga}</>;
  if (estado.fase === 'error') return <>{alFallar(estado.error, reintentar)}</>;

  return (
    <Contexto.Provider
      value={{ db: estado.db, devengo: estado.devengo, refrescar, version }}>
      {children}
    </Contexto.Provider>
  );
}

export function useBase(): ContextoBase {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error('useBase() necesita estar dentro de <ProveedorBase>.');
  }
  return contexto;
}

export type EstadoConsulta<T> = {
  readonly datos: T | null;
  readonly cargando: boolean;
  readonly error: Error | null;
  readonly recargar: () => void;
};

/**
 * Consulta la base y se vuelve a ejecutar cuando algo cambió.
 *
 * Depende de la `version` del proveedor: después de cobrar o desembolsar, un `refrescar()`
 * actualiza todas las pantallas abiertas sin que cada una tenga que avisarle a las demás.
 */
export function useConsulta<T>(
  consulta: (db: SQLiteDatabase) => Promise<T>,
  dependencias: readonly unknown[] = [],
): EstadoConsulta<T> {
  const { db, version } = useBase();
  const [propio, setPropio] = useState(0);
  const [estado, setEstado] = useState<{
    datos: T | null;
    cargando: boolean;
    error: Error | null;
  }>({ datos: null, cargando: true, error: null });

  useEffect(() => {
    let cancelado = false;

    // No se marca "cargando" al entrar al efecto a propósito: llamar a setState en el cuerpo
    // de un efecto dispara renders en cascada. El efecto práctico es mejor, además — al
    // recargar se siguen viendo los datos anteriores en vez de parpadear a un spinner, y las
    // pantallas distinguen la primera carga con `cargando && datos === null`.
    consulta(db)
      .then((resultado) => {
        if (!cancelado) setEstado({ datos: resultado, cargando: false, error: null });
      })
      .catch((problema: unknown) => {
        if (!cancelado) {
          setEstado((anterior) => ({
            datos: anterior.datos,
            cargando: false,
            error: problema instanceof Error ? problema : new Error(String(problema)),
          }));
        }
      });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, propio, ...dependencias]);

  const recargar = useCallback(() => setPropio((anterior) => anterior + 1), []);
  return { ...estado, recargar };
}
