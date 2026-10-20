/**
 * Errores de negocio tipados.
 *
 * Un error de negocio ("esa obligación ya está pagada") no es lo mismo que uno técnico
 * ("la base está bloqueada"). Quien llama necesita distinguirlos para decidir qué mostrar,
 * y por eso cada uno tiene su clase en vez de un `Error` genérico con un string adentro.
 */

export class ErrorDeNegocio extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = new.target.name;
  }
}

/** Se intentó operar con dos montos de monedas distintas. */
export class MonedaIncompatibleError extends ErrorDeNegocio {}

/** Un monto no es un entero de centavos, o no tiene el signo esperado. */
export class MontoInvalidoError extends ErrorDeNegocio {}

/** Una fecha no es un día de calendario válido. */
export class DiaInvalidoError extends ErrorDeNegocio {}

/** Una tasa es negativa, no entera en puntos básicos, o le falta el período. */
export class TasaInvalidaError extends ErrorDeNegocio {}

/** Se pidió una entidad que no está en la base. */
export class ClienteInexistenteError extends ErrorDeNegocio {}
export class PrestamoInexistenteError extends ErrorDeNegocio {}
export class ObligacionInexistenteError extends ErrorDeNegocio {}

/** Se intentó operar sobre un préstamo que ya no está activo. */
export class PrestamoNoActivoError extends ErrorDeNegocio {}

/** El cliente no tiene deuda abierta contra la que imputar un pago. */
export class SinDeudaError extends ErrorDeNegocio {}
