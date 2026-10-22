import { describe, expect, it } from 'vitest';

import { dia } from '../nucleo/fechas';
import {
  CLAVE_ULTIMO_COMPARTIDO,
  diasSinGuardarAfueraDe,
  ultimaCopiaAfueraDe,
} from './repositorios/config';

describe('aviso semanal de copia afuera', () => {
  it('sin ninguna copia mandada, no hay fecha', () => {
    expect(diasSinGuardarAfueraDe({}, dia('2026-10-22'))).toBeNull();
    expect(ultimaCopiaAfueraDe({})).toBeNull();
  });

  it('cuenta los días desde la última copia', () => {
    const config = { [CLAVE_ULTIMO_COMPARTIDO]: '2026-10-15' };
    expect(diasSinGuardarAfueraDe(config, dia('2026-10-22'))).toBe(7);
    expect(diasSinGuardarAfueraDe(config, dia('2026-10-16'))).toBe(1);
    expect(ultimaCopiaAfueraDe(config)).toBe('2026-10-15');
  });

  it('ignora un valor que no es una fecha', () => {
    expect(diasSinGuardarAfueraDe({ [CLAVE_ULTIMO_COMPARTIDO]: 'ayer' }, dia('2026-10-22'))).toBeNull();
  });
});
