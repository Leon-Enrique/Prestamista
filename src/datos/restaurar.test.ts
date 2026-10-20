/**
 * Pruebas de la restauración.
 *
 * "Un respaldo que nunca restauraste no es un respaldo, es un archivo" — el checklist de
 * `pre-release` lo pone como el punto número uno, porque es el único error del que no hay
 * vuelta atrás. Acá se restaura de verdad: dos bases, copia completa, y después se sigue
 * operando sobre la cartera restaurada.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resumenDeuda } from '../dominio/obligaciones';
import type { Condiciones } from '../dominio/tipos';
import { desdeUnidades, formatear, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from '../servicios/cobrar';
import { desembolsar } from '../servicios/desembolsar';
import { devengar } from '../servicios/devengar';
import { crearBaseDePrueba, type BaseDePrueba } from './baseDePrueba';
import { crearCliente, listarClientes } from './repositorios/clientes';
import { obligacionesDePrestamo } from './repositorios/obligaciones';
import {
  copiarContenido,
  RespaldoInvalidoError,
  restaurarContenido,
  validarContenido,
} from './restaurar';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;
const DESEMBOLSO = dia('2026-10-09');
const PRIMER_VENCIMIENTO = dia('2026-11-09');

let origen: BaseDePrueba;
let destino: BaseDePrueba;

beforeEach(async () => {
  origen = await crearBaseDePrueba();
  destino = await crearBaseDePrueba();
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

/** Una cartera con historia: cliente, préstamo, interés devengado, mora y un cobro. */
async function cargarCartera(base: BaseDePrueba, nombre = 'Juan Pérez'): Promise<number> {
  const clienteId = await crearCliente(base.db, { nombre, ci: '1234567' }, AHORA);
  const { prestamoId } = await desembolsar(base.db, {
    clienteId,
    condiciones: condiciones(),
    ahora: AHORA,
  });
  await devengar(base.db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
  await devengar(base.db, { hoy: dia('2026-11-19'), ahora: AHORA });
  await cobrar(base.db, {
    prestamoId,
    monto: desdeUnidades(400, 'BOB'),
    fecha: dia('2026-11-19'),
    medio: 'efectivo',
    ahora: AHORA,
  });
  return prestamoId;
}

const contar = (base: BaseDePrueba, tabla: string): number =>
  Number((base.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n);

describe('validar antes de tocar nada', () => {
  it('acepta un respaldo bueno y dice qué tiene adentro', async () => {
    await cargarCartera(origen);
    const validacion = await validarContenido(origen.db);

    expect(validacion.valido).toBe(true);
    expect(validacion.clientes).toBe(1);
    expect(validacion.prestamos).toBe(1);
    expect(validacion.pagos).toBe(1);
  });

  it('rechaza una base sin migrar', async () => {
    origen.sqlite.exec('PRAGMA user_version = 0');
    const validacion = await validarContenido(origen.db);
    expect(validacion.valido).toBe(false);
    expect(validacion.motivo).toMatch(/no parece un respaldo/i);
  });

  it('rechaza un respaldo de una versión más nueva de la app', async () => {
    origen.sqlite.exec('PRAGMA user_version = 999');
    const validacion = await validarContenido(origen.db);
    expect(validacion.valido).toBe(false);
    expect(validacion.motivo).toMatch(/versión más nueva/i);
  });

  it('rechaza una base a la que le falta una tabla', async () => {
    origen.sqlite.exec('DROP TABLE garantia_fotos');
    const validacion = await validarContenido(origen.db);
    expect(validacion.valido).toBe(false);
    expect(validacion.motivo).toMatch(/garantia_fotos/);
  });

  it('un respaldo inválido no toca el destino', async () => {
    await cargarCartera(destino, 'La cartera que ya estaba');
    origen.sqlite.exec('PRAGMA user_version = 999');

    await expect(restaurarContenido(origen.db, destino.db)).rejects.toThrow(
      RespaldoInvalidoError,
    );

    const clientes = await listarClientes(destino.db);
    expect(clientes).toHaveLength(1);
    expect(clientes[0].nombre).toBe('La cartera que ya estaba');
  });
});

describe('restaurar sobre una base vacía', () => {
  it('trae toda la cartera', async () => {
    const prestamoId = await cargarCartera(origen);
    const copiadas = await copiarContenido(origen.db, destino.db);

    expect(copiadas.clientes).toBe(1);
    expect(copiadas.prestamos).toBe(1);
    expect(copiadas.pagos).toBe(1);
    expect(copiadas.obligaciones).toBe(contar(origen, 'obligaciones'));
    expect(copiadas.movimientos).toBe(contar(origen, 'movimientos'));
    expect(copiadas.imputaciones).toBe(contar(origen, 'imputaciones'));

    const obligaciones = await obligacionesDePrestamo(destino.db, prestamoId);
    const deuda = resumenDeuda(obligaciones, 'BOB', dia('2026-11-19'));
    expect(formatear(deuda.capital)).toBe('Bs 6.000,00');
    expect(formatear(deuda.interes)).toBe('Bs 221,00');
    expect(formatear(deuda.mora)).toBe('Bs 0,00');
  });

  it('conserva el detalle de las imputaciones, que es la prueba de lo que se cobró', async () => {
    await cargarCartera(origen);
    await copiarContenido(origen.db, destino.db);

    const imputaciones = destino.sqlite
      .prepare('SELECT componente, monto_centavos FROM imputaciones ORDER BY id')
      .all() as { componente: string; monto_centavos: number }[];

    expect(imputaciones).toEqual([
      { componente: 'mora', monto_centavos: 2100 },
      { componente: 'interes', monto_centavos: 37_900 },
    ]);
  });

  it('conserva el libro de movimientos completo', async () => {
    await cargarCartera(origen);
    await copiarContenido(origen.db, destino.db);

    const tipos = destino.sqlite
      .prepare('SELECT tipo FROM movimientos ORDER BY id')
      .all()
      .map((fila) => (fila as { tipo: string }).tipo);

    expect(tipos).toContain('desembolso');
    expect(tipos).toContain('devengo_interes');
    expect(tipos).toContain('devengo_mora');
    expect(tipos).toContain('pago');
  });
});

describe('restaurar sobre una base que ya tenía datos', () => {
  it('reemplaza todo: no quedan restos de la cartera anterior', async () => {
    await cargarCartera(destino, 'Cartera vieja');
    await cargarCartera(origen, 'Cartera del respaldo');

    await copiarContenido(origen.db, destino.db);

    const clientes = await listarClientes(destino.db);
    expect(clientes).toHaveLength(1);
    expect(clientes[0].nombre).toBe('Cartera del respaldo');
    expect(contar(destino, 'prestamos')).toBe(1);
    expect(contar(destino, 'pagos')).toBe(1);
  });

  it('la configuración también viene del respaldo', async () => {
    destino.sqlite
      .prepare("UPDATE config SET valor = '99' WHERE clave = 'mora_dias_gracia'")
      .run();
    await cargarCartera(origen);

    await copiarContenido(origen.db, destino.db);

    const fila = destino.sqlite
      .prepare("SELECT valor FROM config WHERE clave = 'mora_dias_gracia'")
      .get() as { valor: string };
    expect(fila.valor).toBe('3');
  });
});

describe('después de restaurar se puede seguir trabajando', () => {
  it('acepta un cliente nuevo sin choque de identificadores', async () => {
    await cargarCartera(origen);
    await copiarContenido(origen.db, destino.db);

    const nuevoId = await crearCliente(destino.db, { nombre: 'María Quispe' }, AHORA);
    const clientes = await listarClientes(destino.db);

    expect(clientes).toHaveLength(2);
    expect(nuevoId).toBeGreaterThan(0);
  });

  it('se le puede seguir cobrando al préstamo restaurado', async () => {
    const prestamoId = await cargarCartera(origen);
    await copiarContenido(origen.db, destino.db);

    // Quedaban Bs 221 de interés y Bs 6.000 de capital.
    const resultado = await cobrar(destino.db, {
      prestamoId,
      monto: desdeUnidades(6221, 'BOB'),
      fecha: dia('2026-11-20'),
      medio: 'efectivo',
      ahora: AHORA,
    });

    expect(formatear(resultado.desglose.interes)).toBe('Bs 221,00');
    expect(formatear(resultado.desglose.capital)).toBe('Bs 6.000,00');
    expect(resultado.prestamoCerrado).toBe(true);
  });

  it('el devengo sigue siendo idempotente sobre la cartera restaurada', async () => {
    await cargarCartera(origen);
    await copiarContenido(origen.db, destino.db);

    // Los períodos ya devengados vinieron en el respaldo con su clave de idempotencia, así
    // que volver a devengar el mismo día no puede duplicar la deuda de nadie.
    const resumen = await devengar(destino.db, { hoy: PRIMER_VENCIMIENTO, ahora: AHORA });
    expect(resumen.interesesCreados).toBe(0);
  });
});

describe('un respaldo de una versión anterior', () => {
  it('entra igual, y la columna que no existía queda en su valor por defecto', async () => {
    await cargarCartera(origen);
    // Simula un respaldo viejo: su tabla de clientes no tenía la columna `referencias`.
    origen.sqlite.exec('ALTER TABLE clientes DROP COLUMN referencias');

    const copiadas = await copiarContenido(origen.db, destino.db);
    expect(copiadas.clientes).toBe(1);

    const clientes = await listarClientes(destino.db);
    expect(clientes[0].nombre).toBe('Juan Pérez');
    expect(clientes[0].referencias).toBeNull();
  });
});
