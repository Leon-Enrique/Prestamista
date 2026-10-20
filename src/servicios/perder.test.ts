import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import { carteraActiva, perdidas } from '../datos/consultas';
import { crearCliente } from '../datos/repositorios/clientes';
import { obtenerPrestamo } from '../datos/repositorios/prestamos';
import { verificar } from '../datos/verificacion';
import { REGLAS_SIN_PENALIZACION } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { PrestamoNoActivoError, SinDeudaError } from '../nucleo/errores';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from './cobrar';
import { desembolsar } from './desembolsar';
import { devengar } from './devengar';
import { darPorPerdido, NoEstaPerdidoError, reactivarPrestamo } from './perder';

const AHORA = '2026-10-20T17:00:00.000Z' as Instante;
const HOY = dia('2026-10-20');

let base: BaseDePrueba;
let clienteId: number;
let prestamoId: number;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  clienteId = await crearCliente(base.db, { nombre: 'Ana', ci: '1', telefono: '7' }, AHORA);
  ({ prestamoId } = await desembolsar(base.db, {
    clienteId,
    condiciones: {
      capital: desdeUnidades(2000, 'BOB'),
      tasa: tasaDesdePorcentaje(10, 'mensual'),
      modalidad: 'cuota_fija',
      frecuencia: 'mensual',
      cantidadPeriodos: 3,
      fechaDesembolso: HOY,
      vencimientoCapital: dia('2027-01-20'),
    },
    reglasMora: REGLAS_SIN_PENALIZACION,
    ahora: AHORA,
  }));
});

async function pagar(monto: number) {
  return cobrar(base.db, {
    prestamoId,
    monto: desdeUnidades(monto, 'BOB'),
    fecha: HOY,
    medio: 'efectivo',
    ahora: AHORA,
  });
}

describe('dar por perdido', () => {
  it('pierde el capital que faltaba cobrar, no el interés futuro', async () => {
    await pagar(804.23); // cuota 1: 200 de interés y 604,23 de capital
    const { perdido } = await darPorPerdido(base.db, {
      prestamoId,
      motivo: 'Se fue del país',
      fecha: HOY,
      ahora: AHORA,
    });

    expect(formatear(perdido)).toBe('Bs 1.395,77');
    const [bob] = await perdidas(base.db);
    expect(formatear(bob.perdido)).toBe('Bs 1.395,77');
    expect(bob.prestamos).toBe(1);
    expect((await verificar(base.db)).cuadra).toBe(true);
  });

  it('el préstamo sale de la cartera y deja de generar interés', async () => {
    await darPorPerdido(base.db, { prestamoId, motivo: 'x', fecha: HOY, ahora: AHORA });
    expect(await carteraActiva(base.db, HOY)).toHaveLength(0);
    expect((await obtenerPrestamo(base.db, prestamoId))!.estado).toBe('incobrable');

    const resumen = await devengar(base.db, { hoy: dia('2027-06-20'), ahora: AHORA });
    expect(resumen.prestamosRevisados).toBe(0);
  });

  it('no se puede cobrar mientras está perdido', async () => {
    await darPorPerdido(base.db, { prestamoId, motivo: 'x', fecha: HOY, ahora: AHORA });
    await expect(pagar(100)).rejects.toThrow(PrestamoNoActivoError);
  });

  it('no se puede perder un préstamo que ya está pagado', async () => {
    await pagar(2412.69);
    await expect(
      darPorPerdido(base.db, { prestamoId, motivo: 'x', fecha: HOY, ahora: AHORA }),
    ).rejects.toThrow(PrestamoNoActivoError);
  });

  it('reactivado, vuelve a la cartera, se puede cobrar y la pérdida desaparece', async () => {
    await darPorPerdido(base.db, { prestamoId, motivo: 'x', fecha: HOY, ahora: AHORA });
    await reactivarPrestamo(base.db, { prestamoId, fecha: HOY, ahora: AHORA });

    expect(await perdidas(base.db)).toHaveLength(0);
    expect(await carteraActiva(base.db, HOY)).toHaveLength(1);
    const cobro = await pagar(804.23);
    expect(formatear(cobro.desglose.interes)).toBe('Bs 200,00');
  });

  it('solo se reactiva lo que está perdido', async () => {
    await expect(
      reactivarPrestamo(base.db, { prestamoId, fecha: HOY, ahora: AHORA }),
    ).rejects.toThrow(NoEstaPerdidoError);
  });

  it('las pérdidas se pueden pedir por cliente', async () => {
    await darPorPerdido(base.db, { prestamoId, motivo: 'x', fecha: HOY, ahora: AHORA });
    const otro = await crearCliente(base.db, { nombre: 'Beto', ci: '2', telefono: '8' }, AHORA);
    expect(await perdidas(base.db, otro)).toHaveLength(0);
    expect(await perdidas(base.db, clienteId)).toHaveLength(1);
  });
});

describe('dar por perdido sin deuda', () => {
  it('un préstamo pagado pero todavía activo no tiene nada que perder', async () => {
    // Caso borde: estado activo sin obligaciones cobrables no debería existir, pero el
    // servicio lo rechaza en vez de registrar una pérdida de cero.
    base.sqlite.prepare("UPDATE obligaciones SET estado = 'pagada' WHERE prestamo_id = ?").run(prestamoId);
    await expect(
      darPorPerdido(base.db, { prestamoId, motivo: 'x', fecha: HOY, ahora: AHORA }),
    ).rejects.toThrow(SinDeudaError);
  });
});
