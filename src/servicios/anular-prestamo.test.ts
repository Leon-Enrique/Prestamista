import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import {
  actividadReciente,
  carteraActiva,
  comportamientoDeCliente,
  deudaPorCliente,
} from '../datos/consultas';
import { crearCliente } from '../datos/repositorios/clientes';
import { obligacionesDePrestamo } from '../datos/repositorios/obligaciones';
import { obtenerPrestamo } from '../datos/repositorios/prestamos';
import { verificar } from '../datos/verificacion';
import { REGLAS_SIN_PENALIZACION } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { PrestamoNoActivoError } from '../nucleo/errores';
import { dia, type Instante } from '../nucleo/fechas';
import { PrestamoConCobrosError, anularPrestamo } from './anular-prestamo';
import { efectivoEsperado, registrarManual } from './caja';
import { cobrar } from './cobrar';
import { desembolsar } from './desembolsar';
import { revertirPago } from './revertir';

const AHORA = '2026-10-22T17:00:00.000Z' as Instante;
const HOY = dia('2026-10-22');

let base: BaseDePrueba;
let clienteId: number;
let prestamoId: number;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  clienteId = await crearCliente(base.db, { nombre: 'Ana', ci: '1', telefono: '7' }, AHORA);
  await registrarManual(base.db, {
    tipo: 'aporte',
    monto: desdeUnidades(5000, 'BOB'),
    fecha: HOY,
    detalle: 'Capital inicial',
    ahora: AHORA,
  });
  ({ prestamoId } = await desembolsar(base.db, {
    clienteId,
    condiciones: {
      capital: desdeUnidades(2000, 'BOB'),
      tasa: tasaDesdePorcentaje(10, 'mensual'),
      modalidad: 'interes_flat',
      frecuencia: 'mensual',
      cantidadPeriodos: 2,
      fechaDesembolso: HOY,
      vencimientoCapital: dia('2026-12-22'),
    },
    reglasMora: REGLAS_SIN_PENALIZACION,
    ahora: AHORA,
  }));
});

const anular = () =>
  anularPrestamo(base.db, { prestamoId, motivo: 'Se arrepintió', fecha: HOY, ahora: AHORA });

describe('anular préstamo', () => {
  it('la plata vuelve a la caja y el préstamo queda anulado', async () => {
    expect(formatear(await efectivoEsperado(base.db, 'BOB'))).toBe('Bs 3.000,00');
    const { devueltoACaja } = await anular();

    expect(formatear(devueltoACaja!)).toBe('Bs 2.000,00');
    expect(formatear(await efectivoEsperado(base.db, 'BOB'))).toBe('Bs 5.000,00');
    expect((await obtenerPrestamo(base.db, prestamoId))!.estado).toBe('anulado');
    const obligaciones = await obligacionesDePrestamo(base.db, prestamoId);
    expect(obligaciones.every((o) => o.estado === 'anulada')).toBe(true);
    expect((await verificar(base.db)).cuadra).toBe(true);
  });

  it('desaparece de la cartera, de la deuda del cliente y de lo prestado', async () => {
    await anular();
    expect(await carteraActiva(base.db, HOY)).toHaveLength(0);
    expect((await deudaPorCliente(base.db, HOY)).has(clienteId)).toBe(false);
    // Un préstamo anulado no cuenta como prestado: no queda ningún resumen para el cliente.
    expect(await comportamientoDeCliente(base.db, clienteId)).toHaveLength(0);
    expect((await actividadReciente(base.db)).some((a) => a.tipo === 'prestamo')).toBe(false);
  });

  it('no se puede si ya tiene cobros', async () => {
    await cobrar(base.db, {
      prestamoId,
      monto: desdeUnidades(100, 'BOB'),
      fecha: HOY,
      medio: 'efectivo',
      ahora: AHORA,
    });
    await expect(anular()).rejects.toThrow(PrestamoConCobrosError);
  });

  it('con los cobros anulados, sí se puede', async () => {
    const pago = await cobrar(base.db, {
      prestamoId,
      monto: desdeUnidades(100, 'BOB'),
      fecha: HOY,
      medio: 'efectivo',
      ahora: AHORA,
    });
    await revertirPago(base.db, { pagoId: pago.pagoId, motivo: 'Error', fecha: HOY, ahora: AHORA });
    await anular();
    expect((await obtenerPrestamo(base.db, prestamoId))!.estado).toBe('anulado');
  });

  it('no se anula dos veces', async () => {
    await anular();
    await expect(anular()).rejects.toThrow(PrestamoNoActivoError);
  });
});
