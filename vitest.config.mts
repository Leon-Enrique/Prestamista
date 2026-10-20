import { defineConfig } from 'vitest/config';

/**
 * Pruebas de `src/dominio/` y `src/nucleo/`.
 *
 * Corren en Node, sin React Native ni emulador, porque esas capas son código puro: no
 * importan SQLite, no importan React y no leen el reloj. Esa es la razón práctica de la
 * regla de pureza — los cálculos de plata se prueban en milisegundos.
 */
export default defineConfig({
  test: {
    // Todo `src`, no una lista de carpetas: una lista se olvida de actualizar y los tests
    // de una carpeta nueva pasan a no correr sin que nadie se entere.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
