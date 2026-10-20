import { describe, expect, it } from 'vitest';

import type { Condiciones } from '../dominio/tipos';
import { desdeUnidades, tasaDesdePorcentaje } from '../nucleo/dinero';
import { dia, type Instante } from '../nucleo/fechas';
import { cobrar } from '../servicios/cobrar';
import { desembolsar } from '../servicios/desembolsar';
import { devengar } from '../servicios/devengar';
import { crearBaseDePrueba } from './baseDePrueba';
import { carteraACsv, escaparCampo, exportarCarteraACsv, type FilaCartera } from './cartera-csv';
import { crearCliente } from './repositorios/clientes';

const AHORA = '2026-10-09T17:00:00.000Z' as Instante;

function fila(overrides: Partial<FilaCartera> = {}): FilaCartera {
  return {
    cliente: 'Juan Pérez',
    ci: '1234567',
    telefono: '70000000',
    prestamo_id: 1,
    moneda: 'BOB',
    modalidad: 'solo_interes',
    tasa_puntos_basicos: 1000,
    tasa_periodo: 'mensual',
    estado_prestamo: 'activo',
    tipo: 'interes',
    numero: 1,
    vencimiento: '2026-11-09',
    capital_centavos: 0,
    interes_centavos: 60_000,
    mora_centavos: 0,
    pagado_capital_centavos: 0,
    pagado_interes_centavos: 0,
    pagado_mora_centavos: 0,
    estado: 'pendiente',
    ...overrides,
  };
}

describe('escapar campos', () => {
  it('deja en paz lo que no necesita comillas', () => {
    expect(escaparCampo('Juan Pérez')).toBe('Juan Pérez');
  });

  it('entrecomilla lo que tiene el separador adentro', () => {
    expect(escaparCampo('Pérez; Juan')).toBe('"Pérez; Juan"');
  });

  it('duplica las comillas internas', () => {
    expect(escaparCampo('el "Chino"')).toBe('"el ""Chino"""');
  });

  it('entrecomilla lo que tiene saltos de línea', () => {
    expect(escaparCampo('calle 1\nzona sur')).toBe('"calle 1\nzona sur"');
  });
});

describe('armar la planilla', () => {
  it('pone los encabezados y una línea por obligación', () => {
    const csv = carteraACsv([fila(), fila({ numero: 2, vencimiento: '2026-12-09' })]);
    const lineas = csv.trimEnd().split('\r\n');

    expect(lineas).toHaveLength(3);
    expect(lineas[0].startsWith('Cliente;CI;Teléfono')).toBe(true);
  });

  it('muestra los montos con coma decimal, que es como se escriben acá', () => {
    const csv = carteraACsv([fila()]);
    expect(csv).toContain('600,00');
  });

  it('usa punto y coma de separador, para que la coma decimal no parta las columnas', () => {
    const csv = carteraACsv([fila()]);
    const columnas = csv.trimEnd().split('\r\n')[1].split(';');
    expect(columnas[0]).toBe('Juan Pérez');
    expect(columnas[1]).toBe('1234567');
  });

  it('calcula total, pagado y saldo', () => {
    const csv = carteraACsv([
      fila({ interes_centavos: 60_000, mora_centavos: 2100, pagado_mora_centavos: 2100 }),
    ]);
    const columnas = csv.trimEnd().split('\r\n')[1].split(';');

    // ... Capital; Interés; Mora; Total; Pagado; Saldo; Estado
    expect(columnas.slice(-7)).toEqual([
      '0,00',
      '600,00',
      '21,00',
      '621,00',
      '21,00',
      '600,00',
      'pendiente',
    ]);
  });

  it('muestra la fecha como se lee en Bolivia, y avisa cuando no hay vencimiento', () => {
    expect(carteraACsv([fila()])).toContain('09/11/2026');
    expect(carteraACsv([fila({ vencimiento: null })])).toContain('sin vencimiento');
  });

  it('muestra la tasa con su período', () => {
    expect(carteraACsv([fila()])).toContain('10% mensual');
    expect(carteraACsv([fila({ tasa_puntos_basicos: 1250 })])).toContain('12,5% mensual');
  });

  it('con la cartera vacía deja solo los encabezados', () => {
    const csv = carteraACsv([]);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(1);
  });
});

describe('exportar desde la base', () => {
  it('arma la planilla con la cartera real, legible sin la app', async () => {
    const base = await crearBaseDePrueba();
    const clienteId = await crearCliente(
      base.db,
      { nombre: 'Juan Pérez', ci: '1234567', telefono: '70000000' },
      AHORA,
    );
    const condiciones: Condiciones = {
      capital: desdeUnidades(6000, 'BOB'),
      tasa: tasaDesdePorcentaje(10, 'mensual'),
      modalidad: 'solo_interes',
      frecuencia: 'mensual',
      cantidadPeriodos: null,
      fechaDesembolso: dia('2026-10-09'),
      vencimientoCapital: dia('2027-04-09'),
    };
    const { prestamoId } = await desembolsar(base.db, { clienteId, condiciones, ahora: AHORA });
    await devengar(base.db, { hoy: dia('2026-11-09'), ahora: AHORA });
    await cobrar(base.db, {
      prestamoId,
      monto: desdeUnidades(600, 'BOB'),
      fecha: dia('2026-11-09'),
      medio: 'efectivo',
      ahora: AHORA,
    });

    const csv = await exportarCarteraACsv(base.db);

    expect(csv).toContain('Juan Pérez');
    // El interés del primer mes, cobrado.
    expect(csv).toContain('Interés;1;09/11/2026');
    // El capital, que sigue debiendo entero.
    expect(csv).toContain('Capital;;09/04/2027');
    expect(csv).toContain('6.000,00');
  });
});
