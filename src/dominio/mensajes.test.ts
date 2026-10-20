import { describe, expect, it } from 'vitest';

import { desdeUnidades, type Dinero } from '../nucleo/dinero';
import { dia } from '../nucleo/fechas';
import {
  aNumeroDeWhatsApp,
  mensajeDeRecibo,
  mensajeDeRecordatorio,
  primerNombre,
} from './mensajes';
import type { Componente } from './tipos';

const bs = (unidades: number): Dinero => desdeUnidades(unidades, 'BOB');

const desglose = (
  mora: number,
  interes: number,
  capital: number,
): Record<Componente, Dinero> => ({
  mora: bs(mora),
  interes: bs(interes),
  capital: bs(capital),
});

describe('primerNombre', () => {
  it('toma solo el nombre', () => {
    expect(primerNombre('Juan Pérez Quispe')).toBe('Juan');
    expect(primerNombre('  María  ')).toBe('María');
  });

  it('no se rompe con un nombre vacío', () => {
    expect(primerNombre('')).toBe('Hola');
    expect(primerNombre('   ')).toBe('Hola');
  });
});

describe('recibo', () => {
  it('lleva el monto, la fecha y el desglose de lo que se cobró', () => {
    const texto = mensajeDeRecibo({
      cliente: 'Juan Pérez',
      monto: bs(400),
      fecha: dia('2026-11-19'),
      desglose: desglose(21, 379, 0),
      saldoRestante: bs(6221),
      prestamoCerrado: false,
    });

    expect(texto).toContain('Hola Juan.');
    expect(texto).toContain('Recibí tu pago de Bs 400,00 del 19/11/2026.');
    expect(texto).toContain('- Penalización: Bs 21,00');
    expect(texto).toContain('- Interés: Bs 379,00');
    expect(texto).toContain('Te queda un saldo de Bs 6.221,00.');
  });

  it('no muestra los componentes en cero', () => {
    const texto = mensajeDeRecibo({
      cliente: 'Juan Pérez',
      monto: bs(400),
      fecha: dia('2026-11-19'),
      desglose: desglose(21, 379, 0),
      saldoRestante: bs(6221),
      prestamoCerrado: false,
    });
    expect(texto).not.toContain('Capital');
  });

  it('cuando queda saldado, lo dice en vez de mostrar un saldo en cero', () => {
    const texto = mensajeDeRecibo({
      cliente: 'Juan Pérez',
      monto: bs(6621),
      fecha: dia('2026-11-19'),
      desglose: desglose(21, 600, 6000),
      saldoRestante: bs(0),
      prestamoCerrado: true,
    });

    expect(texto).toContain('Con esto queda saldado.');
    expect(texto).not.toContain('Te queda un saldo');
  });

  it('respeta el orden mora, interés, capital, igual que la imputación', () => {
    const texto = mensajeDeRecibo({
      cliente: 'Juan',
      monto: bs(700),
      fecha: dia('2026-11-19'),
      desglose: desglose(21, 379, 300),
      saldoRestante: bs(100),
      prestamoCerrado: false,
    });

    expect(texto.indexOf('Penalización')).toBeLessThan(texto.indexOf('Interés'));
    expect(texto.indexOf('Interés')).toBeLessThan(texto.indexOf('Capital'));
  });
});

describe('recordatorio', () => {
  it('dice qué venció, cuándo y hace cuántos días', () => {
    const texto = mensajeDeRecordatorio({
      cliente: 'Juan Pérez',
      vencido: bs(621),
      total: bs(6621),
      vencimiento: dia('2026-11-09'),
      diasDeAtraso: 10,
    });

    expect(texto).toContain('Hola Juan');
    expect(texto).toContain('el 09/11/2026 venció un pago de Bs 621,00');
    expect(texto).toContain('hace 10 días');
    expect(texto).toContain('El total pendiente es Bs 6.621,00.');
  });

  it('usa el singular con un solo día de atraso', () => {
    const texto = mensajeDeRecordatorio({
      cliente: 'Juan',
      vencido: bs(621),
      total: bs(621),
      vencimiento: dia('2026-11-09'),
      diasDeAtraso: 1,
    });
    expect(texto).toContain('hace 1 día');
  });

  it('no repite el total cuando es lo mismo que lo vencido', () => {
    const texto = mensajeDeRecordatorio({
      cliente: 'Juan',
      vencido: bs(621),
      total: bs(621),
      vencimiento: dia('2026-11-09'),
      diasDeAtraso: 5,
    });
    expect(texto).not.toContain('El total pendiente');
  });

  it('sirve también para avisar antes de que venza', () => {
    const texto = mensajeDeRecordatorio({
      cliente: 'Juan',
      vencido: bs(0),
      total: bs(600),
      vencimiento: dia('2026-12-09'),
      diasDeAtraso: 0,
    });

    expect(texto).toContain('el 09/12/2026 tenés un pago de Bs 600,00');
    expect(texto).not.toContain('venció');
  });

  it('funciona con un préstamo sin vencimiento', () => {
    const texto = mensajeDeRecordatorio({
      cliente: 'Juan',
      vencido: bs(0),
      total: bs(6000),
      vencimiento: null,
      diasDeAtraso: 0,
    });
    expect(texto).toContain('saldo pendiente de Bs 6.000,00');
  });

  it('cierra ofreciendo acomodarlo, no presionando', () => {
    const texto = mensajeDeRecordatorio({
      cliente: 'Juan',
      vencido: bs(621),
      total: bs(621),
      vencimiento: dia('2026-11-09'),
      diasDeAtraso: 10,
    });
    expect(texto).toContain('Si necesitás acomodarlo, avisame.');
  });
});

describe('número de WhatsApp', () => {
  it('le pone el código de país a un número local', () => {
    expect(aNumeroDeWhatsApp('70000000', '591')).toBe('59170000000');
  });

  it('respeta el que ya lo trae, escrito como sea', () => {
    expect(aNumeroDeWhatsApp('59170000000', '591')).toBe('59170000000');
    expect(aNumeroDeWhatsApp('+591 7000-0000', '591')).toBe('59170000000');
    expect(aNumeroDeWhatsApp('(591) 70 00 00 00', '591')).toBe('59170000000');
  });

  it('limpia los separadores que la gente escribe', () => {
    expect(aNumeroDeWhatsApp('7000-0000', '591')).toBe('59170000000');
    expect(aNumeroDeWhatsApp('7 000 0000', '591')).toBe('59170000000');
  });

  it('saca los ceros del marcado local', () => {
    expect(aNumeroDeWhatsApp('070000000', '591')).toBe('59170000000');
  });

  it('devuelve null cuando no hay nada aprovechable', () => {
    expect(aNumeroDeWhatsApp(null, '591')).toBeNull();
    expect(aNumeroDeWhatsApp('', '591')).toBeNull();
    expect(aNumeroDeWhatsApp('sin teléfono', '591')).toBeNull();
    expect(aNumeroDeWhatsApp('000', '591')).toBeNull();
  });

  it('sirve para otro país si se configura otro código', () => {
    expect(aNumeroDeWhatsApp('1122334455', '54')).toBe('541122334455');
    expect(aNumeroDeWhatsApp('541122334455', '54')).toBe('541122334455');
  });
});
