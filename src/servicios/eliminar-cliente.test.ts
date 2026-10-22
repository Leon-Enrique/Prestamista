import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import { cobradoEnPeriodo } from '../datos/consultas';
import { crearCliente, listarClientes, obtenerCliente } from '../datos/repositorios/clientes';
import { REGLAS_SIN_PENALIZACION } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from './cobrar';
import { desembolsar } from './desembolsar';
import { ClienteConDeudaError, eliminarCliente } from './eliminar-cliente';
import { darPorPerdido } from './perder';

const AHORA = '2026-10-22T17:00:00.000Z' as Instante;
const HOY = dia('2026-10-22');

let base: BaseDePrueba;
let clienteId: number;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  clienteId = await crearCliente(base.db, { nombre: 'Ana', ci: '1', telefono: '7' }, AHORA);
});

async function prestar() {
  const { prestamoId } = await desembolsar(base.db, {
    clienteId,
    condiciones: {
      capital: desdeUnidades(1000, 'BOB'),
      tasa: tasaDesdePorcentaje(10, 'mensual'),
      modalidad: 'interes_flat',
      frecuencia: 'mensual',
      cantidadPeriodos: 1,
      fechaDesembolso: HOY,
      vencimientoCapital: dia('2026-11-22'),
    },
    reglasMora: REGLAS_SIN_PENALIZACION,
    ahora: AHORA,
  });
  return prestamoId;
}

describe('eliminar cliente', () => {
  it('un cliente sin préstamos sale de la lista', async () => {
    await eliminarCliente(base.db, { clienteId, hoy: HOY, ahora: AHORA });
    expect(await listarClientes(base.db)).toHaveLength(0);
    expect((await obtenerCliente(base.db, clienteId))!.activo).toBe(false);
  });

  it('no deja eliminar a quien todavía debe', async () => {
    await prestar();
    await expect(eliminarCliente(base.db, { clienteId, hoy: HOY, ahora: AHORA })).rejects.toThrow(
      ClienteConDeudaError,
    );
    expect(await listarClientes(base.db)).toHaveLength(1);
  });

  it('si ya pagó todo, se elimina y lo que pagó sigue contando', async () => {
    const prestamoId = await prestar();
    await cobrar(base.db, {
      prestamoId,
      monto: desdeUnidades(1100, 'BOB'),
      fecha: HOY,
      medio: 'efectivo',
      ahora: AHORA,
    });
    await eliminarCliente(base.db, { clienteId, hoy: HOY, ahora: AHORA });

    expect(await listarClientes(base.db)).toHaveLength(0);
    const [bob] = await cobradoEnPeriodo(base.db, HOY, HOY);
    expect(formatear(bob.interes)).toBe('Bs 100,00');
  });

  it('un préstamo dado por perdido no impide eliminarlo', async () => {
    const prestamoId = await prestar();
    await darPorPerdido(base.db, { prestamoId, motivo: 'x', fecha: HOY, ahora: AHORA });
    await eliminarCliente(base.db, { clienteId, hoy: HOY, ahora: AHORA });
    expect(await listarClientes(base.db)).toHaveLength(0);
  });
});
