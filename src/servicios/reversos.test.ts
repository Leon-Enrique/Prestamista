/**
 * Pruebas de anular un pago y condonar.
 *
 * Equivocarse anotando un cobro es cosa de todos los días, así que esto tiene que funcionar
 * perfecto: dejar los saldos exactamente como estaban antes, no borrar la historia, y que el
 * libro siga cuadrando con los saldos cacheados.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { crearBaseDePrueba, type BaseDePrueba } from '../datos/baseDePrueba';
import type { EjecutorSQL } from '../datos/ejecutor';
import { crearCliente } from '../datos/repositorios/clientes';
import { obligacionesDePrestamo } from '../datos/repositorios/obligaciones';
import { obtenerPago, pagosDePrestamo, PagoYaRevertidoError } from '../datos/repositorios/pagos';
import { obtenerPrestamo } from '../datos/repositorios/prestamos';
import { comportamientoDeCliente } from '../datos/consultas';
import { verificar } from '../datos/verificacion';
import { resumenDeuda } from '../dominio/obligaciones';
import type { Condiciones } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from './cobrar';
import { condonar, NoSePuedeCondonarError } from './condonar';
import { desembolsar } from './desembolsar';
import { devengar } from './devengar';
import { revertirPago } from './revertir';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;
const DESEMBOLSO = dia('2026-10-09');
const PRIMER_VENCIMIENTO = dia('2026-11-09');
const DIEZ_DIAS_TARDE = dia('2026-11-19');

let base: BaseDePrueba;
let db: EjecutorSQL;

beforeEach(async () => {
  base = await crearBaseDePrueba();
  db = base.db;
});

function condiciones(overrides: Partial<Condiciones> = {}): Condiciones {
  return {
    capital: desdeUnidades(6000, 'BOB'),
    tasa: tasaDesdePorcentaje(10, 'mensual'),
    modalidad: 'solo_interes',
    frecuencia: 'mensual',
    cantidadPeriodos: null,
    fechaDesembolso: DESEMBOLSO,
    vencimientoCapital: dia('2027-04-09'),
    ...overrides,
  };
}

/** Préstamo con interés devengado y mora: el escenario donde se cobra y se puede errar. */
async function prestamoConDeuda(): Promise<number> {
  const clienteId = await crearCliente(db, { nombre: 'Juan Pérez' }, AHORA);
  const { prestamoId } = await desembolsar(db, {
    clienteId,
    condiciones: condiciones(),
    ahora: AHORA,
  });
  await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
  await devengar(db, { hoy: DIEZ_DIAS_TARDE, ahora: AHORA });
  return prestamoId;
}

async function deudaDe(prestamoId: number, hasta = DIEZ_DIAS_TARDE) {
  return resumenDeuda(await obligacionesDePrestamo(db, prestamoId), 'BOB', hasta);
}

describe('anular un pago', () => {
  it('deja los saldos exactamente como estaban antes', async () => {
    const prestamoId = await prestamoConDeuda();
    const antes = await deudaDe(prestamoId);

    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect(formatear((await deudaDe(prestamoId)).total)).not.toBe(formatear(antes.total));

    await revertirPago(db, {
      pagoId,
      motivo: 'Me equivoqué de monto',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });

    const despues = await deudaDe(prestamoId);
    expect(formatear(despues.mora)).toBe(formatear(antes.mora));
    expect(formatear(despues.interes)).toBe(formatear(antes.interes));
    expect(formatear(despues.capital)).toBe(formatear(antes.capital));
    expect(formatear(despues.total)).toBe(formatear(antes.total));
  });

  it('devuelve el desglose de lo que se deshizo', async () => {
    const prestamoId = await prestamoConDeuda();
    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });

    const reverso = await revertirPago(db, {
      pagoId,
      motivo: 'Era de otro cliente',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });

    expect(formatear(reverso.desglose.mora)).toBe('Bs 21,00');
    expect(formatear(reverso.desglose.interes)).toBe('Bs 379,00');
    expect(formatear(reverso.total)).toBe('Bs 400,00');
  });

  it('no borra el pago: queda marcado con su motivo', async () => {
    const prestamoId = await prestamoConDeuda();
    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });

    await revertirPago(db, {
      pagoId,
      motivo: 'Me equivoqué de monto',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });

    const pago = await obtenerPago(db, pagoId);
    expect(pago).not.toBeNull();
    expect(pago!.revertidoEn).toBe(AHORA);
    expect(pago!.motivoReverso).toBe('Me equivoqué de monto');

    // Las imputaciones tampoco se borran: la historia queda completa.
    const imputaciones = base.sqlite
      .prepare('SELECT COUNT(*) AS n FROM imputaciones WHERE pago_id = ?')
      .get(pagoId) as { n: number };
    expect(Number(imputaciones.n)).toBe(2);

    // Y sigue apareciendo en la lista de pagos del préstamo.
    const pagos = await pagosDePrestamo(db, prestamoId);
    expect(pagos).toHaveLength(1);
  });

  it('deja un asiento de reverso en negativo, apuntando al original', async () => {
    const prestamoId = await prestamoConDeuda();
    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });

    await revertirPago(db, { pagoId, motivo: 'error', fecha: DIEZ_DIAS_TARDE, ahora: AHORA });

    const asiento = base.sqlite
      .prepare(
        `SELECT interes_centavos, mora_centavos, movimiento_revertido_id
           FROM movimientos WHERE tipo = 'reverso'`,
      )
      .get() as {
      interes_centavos: number;
      mora_centavos: number;
      movimiento_revertido_id: number | null;
    };

    expect(asiento.interes_centavos).toBe(-37_900);
    expect(asiento.mora_centavos).toBe(-2100);
    expect(asiento.movimiento_revertido_id).not.toBeNull();
  });

  it('saca la plata de la caja si había entrado en efectivo', async () => {
    const prestamoId = await prestamoConDeuda();
    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });
    await revertirPago(db, { pagoId, motivo: 'error', fecha: DIEZ_DIAS_TARDE, ahora: AHORA });

    const neto = base.sqlite
      .prepare("SELECT SUM(monto_centavos) AS n FROM caja_movimientos WHERE pago_id = ?")
      .get(pagoId) as { n: number };
    expect(Number(neto.n)).toBe(0);
  });

  it('no toca la caja si el pago había sido por transferencia', async () => {
    const prestamoId = await prestamoConDeuda();
    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'transferencia',
      ahora: AHORA,
    });
    await revertirPago(db, { pagoId, motivo: 'error', fecha: DIEZ_DIAS_TARDE, ahora: AHORA });

    const movimientos = base.sqlite
      .prepare('SELECT COUNT(*) AS n FROM caja_movimientos WHERE pago_id = ?')
      .get(pagoId) as { n: number };
    expect(Number(movimientos.n)).toBe(0);
  });

  it('reabre el préstamo si se había cerrado por ese pago', async () => {
    const prestamoId = await prestamoConDeuda();
    const { pagoId, prestamoCerrado } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(6621, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect(prestamoCerrado).toBe(true);

    const reverso = await revertirPago(db, {
      pagoId,
      motivo: 'No pagó, me confundí',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });

    expect(reverso.prestamoReabierto).toBe(true);
    expect((await obtenerPrestamo(db, prestamoId))!.estado).toBe('activo');
  });

  it('un cobro anulado deja de contar como ganancia', async () => {
    const clienteId = await crearCliente(db, { nombre: 'Juan Pérez' }, AHORA);
    const { prestamoId } = await desembolsar(db, {
      clienteId,
      condiciones: condiciones(),
      ahora: AHORA,
    });
    await devengar(db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });

    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(600, 'BOB'),
      fecha: PRIMER_VENCIMIENTO,
      medio: 'efectivo',
      ahora: AHORA,
    });

    const conPago = await comportamientoDeCliente(db, clienteId);
    expect(formatear(conPago[0].interesCobrado)).toBe('Bs 600,00');

    await revertirPago(db, { pagoId, motivo: 'error', fecha: PRIMER_VENCIMIENTO, ahora: AHORA });

    const anulado = await comportamientoDeCliente(db, clienteId);
    expect(formatear(anulado[0].interesCobrado)).toBe('Bs 0,00');
  });

  it('no se puede anular dos veces', async () => {
    const prestamoId = await prestamoConDeuda();
    const { pagoId } = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });
    await revertirPago(db, { pagoId, motivo: 'error', fecha: DIEZ_DIAS_TARDE, ahora: AHORA });

    await expect(
      revertirPago(db, { pagoId, motivo: 'otra vez', fecha: DIEZ_DIAS_TARDE, ahora: AHORA }),
    ).rejects.toThrow(PagoYaRevertidoError);
  });

  it('se le puede volver a cobrar bien después de anular', async () => {
    const prestamoId = await prestamoConDeuda();
    const malo = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(4000, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });
    await revertirPago(db, {
      pagoId: malo.pagoId,
      motivo: 'Puse 4000 y eran 400',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });

    const bueno = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });

    expect(formatear(bueno.desglose.mora)).toBe('Bs 21,00');
    expect(formatear(bueno.desglose.interes)).toBe('Bs 379,00');
  });
});

describe('condonar', () => {
  it('perdona la mora y la deja registrada, no borrada', async () => {
    const prestamoId = await prestamoConDeuda();
    const obligaciones = await obligacionesDePrestamo(db, prestamoId);
    const mora = obligaciones.find((o) => o.tipo === 'mora')!;

    const resultado = await condonar(db, {
      obligacionId: mora.id,
      motivo: 'Vino el mismo día, le perdono los días',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });

    expect(formatear(resultado.condonado)).toBe('Bs 21,00');

    const despues = await obligacionesDePrestamo(db, prestamoId);
    const moraDespues = despues.find((o) => o.id === mora.id)!;
    expect(moraDespues.estado).toBe('condonada');
    // Sigue existiendo, con su monto: así se puede ver cuánto se perdonó y a quién.
    expect(formatear(moraDespues.mora)).toBe('Bs 21,00');

    const deuda = await deudaDe(prestamoId);
    expect(formatear(deuda.mora)).toBe('Bs 0,00');
  });

  it('deja su asiento en el libro', async () => {
    const prestamoId = await prestamoConDeuda();
    const mora = (await obligacionesDePrestamo(db, prestamoId)).find((o) => o.tipo === 'mora')!;

    await condonar(db, {
      obligacionId: mora.id,
      motivo: 'cliente de años',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });

    const asiento = base.sqlite
      .prepare("SELECT mora_centavos, detalle FROM movimientos WHERE tipo = 'condonacion'")
      .get() as { mora_centavos: number; detalle: string };

    expect(asiento.mora_centavos).toBe(-2100);
    expect(asiento.detalle).toContain('cliente de años');
  });

  it('una obligación condonada ya no recibe pagos', async () => {
    const prestamoId = await prestamoConDeuda();
    const mora = (await obligacionesDePrestamo(db, prestamoId)).find((o) => o.tipo === 'mora')!;
    await condonar(db, {
      obligacionId: mora.id,
      motivo: 'perdonada',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });

    const resultado = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });

    // Los 400 enteros van al interés: la mora perdonada no se cobra.
    expect(formatear(resultado.desglose.mora)).toBe('Bs 0,00');
    expect(formatear(resultado.desglose.interes)).toBe('Bs 400,00');
  });

  it('no deja condonar capital: eso es dar la plata por perdida', async () => {
    const prestamoId = await prestamoConDeuda();
    const capital = (await obligacionesDePrestamo(db, prestamoId)).find(
      (o) => o.tipo === 'capital',
    )!;

    await expect(
      condonar(db, {
        obligacionId: capital.id,
        motivo: 'da igual',
        fecha: DIEZ_DIAS_TARDE,
        ahora: AHORA,
      }),
    ).rejects.toThrow(NoSePuedeCondonarError);
  });

  it('no deja condonar dos veces', async () => {
    const prestamoId = await prestamoConDeuda();
    const mora = (await obligacionesDePrestamo(db, prestamoId)).find((o) => o.tipo === 'mora')!;
    const params = {
      obligacionId: mora.id,
      motivo: 'perdonada',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    };

    await condonar(db, params);
    await expect(condonar(db, params)).rejects.toThrow(NoSePuedeCondonarError);
  });
});

describe('el libro siempre cuadra con los saldos', () => {
  it('después de cobrar, anular, volver a cobrar y condonar', async () => {
    const prestamoId = await prestamoConDeuda();

    const malo = await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(4000, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect((await verificar(db)).cuadra).toBe(true);

    await revertirPago(db, {
      pagoId: malo.pagoId,
      motivo: 'monto equivocado',
      fecha: DIEZ_DIAS_TARDE,
      ahora: AHORA,
    });
    expect((await verificar(db)).cuadra).toBe(true);

    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });
    expect((await verificar(db)).cuadra).toBe(true);

    const mora = (await obligacionesDePrestamo(db, prestamoId)).find(
      (o) => o.tipo === 'mora' && o.estado !== 'pagada',
    );
    if (mora) {
      await condonar(db, {
        obligacionId: mora.id,
        motivo: 'resto perdonado',
        fecha: DIEZ_DIAS_TARDE,
        ahora: AHORA,
      });
    }

    const resumen = await verificar(db);
    expect(resumen.descuadres).toEqual([]);
    expect(resumen.cuadra).toBe(true);
  });

  it('detecta un descuadre si alguien toca un saldo a mano', async () => {
    const prestamoId = await prestamoConDeuda();
    await cobrar(db, {
      prestamoId,
      monto: desdeUnidades(400, 'BOB'),
      fecha: DIEZ_DIAS_TARDE,
      medio: 'efectivo',
      ahora: AHORA,
    });

    // Simula el bug que esta verificación existe para encontrar.
    base.sqlite
      .prepare(
        `UPDATE obligaciones SET pagado_interes_centavos = 1
          WHERE tipo = 'interes' AND pagado_interes_centavos > 0`,
      )
      .run();

    const resumen = await verificar(db);
    expect(resumen.cuadra).toBe(false);
    expect(resumen.descuadres[0].componente).toBe('interes');
    expect(formatear(resumen.descuadres[0].enElLibro)).toBe('Bs 379,00');
    expect(formatear(resumen.descuadres[0].enLaObligacion)).toBe('Bs 0,01');
  });
});
