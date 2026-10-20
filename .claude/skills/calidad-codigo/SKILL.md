---
name: calidad-codigo
description: Convenciones de calidad de código — naming, manejo de errores, logging, pruebas de los cálculos de plata, y criterios de un cambio aceptable. Consultar al escribir o revisar cualquier código del proyecto.
---

# Calidad de código

Cubre **cómo se escribe el código**, no qué arquitectura usar (eso vive en
`arquitectura-app`) ni qué reglas de negocio implementar (eso vive en `dominio-prestamos`).
Si algo de acá choca con una decisión de arquitectura, gana la arquitectura.

---

## Naming

- **Negocio**: en **español**, reflejando el lenguaje con el que el usuario habla de su
  trabajo: `generarCronograma`, `imputarPago`, `devengarInteres`, `calcularMora`,
  `obligacionesVencidas`.
- **Infraestructura de framework**: en inglés, porque es la convención de la librería
  (`useState`, `openDatabaseAsync`, props de React Native).
- No mezcles los dos idiomas dentro del mismo módulo sin razón.
- Nombres que reflejan el negocio, no detalles técnicos: `verificarLimiteCredito()`, no
  `checkField()`.
- Sin abreviaturas ambiguas: `prestamo`, no `prest`; `obligacion`, no `obl`. `ci` y `apr` sí,
  porque son términos del dominio.
- **Distinguí préstamo de obligación en los nombres.** `obtenerPrestamo` y
  `obtenerObligacion` devuelven cosas distintas, y un `prestamoId` que en realidad guarda
  una obligación es una fuente permanente de bugs (ver `dominio-prestamos`).
- **Todo nombre de variable de plata dice que son centavos** o es de tipo `Dinero`:
  `montoCentavos`, no `monto`. Un `monto: number` ambiguo es cómo se cuela un bug de factor
  cien, y un factor cien en un préstamo es un desastre.
- Booleanos con la pregunta clara: `estaVencida`, `tieneMoraAbierta`, `fueRevertido`.
- Funciones con verbo (`calcularTotal`, `aplicarCondonacion`); nunca un sustantivo solo para
  una función que hace algo.

## Manejo de errores

- Excepciones de dominio explícitas y tipadas: `MontoInvalidoError`,
  `ObligacionYaPagadaError`, `MonedaIncompatibleError`, `PeriodoYaDevengadoError`. No un
  `Error` genérico para un error de negocio: quien llama necesita distinguir el tipo para
  decidir qué mostrar.
- Un error de negocio ("ese período ya está devengado") no es lo mismo que uno técnico
  ("la base está bloqueada"). No los mezcles en la misma jerarquía ni los muestres igual.
- Nunca un `catch` vacío, y nunca silenciar un error para que el flujo "no se rompa". En una
  app de plata, un error escondido es un cobro que no se guardó y nadie se enteró.
- **Un error al guardar un cobro se le dice al usuario, en pantalla, con claridad.** Él tiene
  a la persona enfrente: necesita saber ahora si quedó registrado o no.

## Logging

- Nivel correcto: `debug` para desarrollo, `info` para eventos de negocio (préstamo
  desembolsado, pago registrado, respaldo exportado), `warn` para algo inesperado no fatal,
  `error` para fallas que requieren atención.
- **Nunca loguear datos personales ni montos de una persona identificable**: nada de nombre,
  CI, teléfono, dirección ni deuda. Si hace falta trazabilidad, logueá el id, no el dato.
  Son datos de deuda de gente real y los logs se comparten sin pensar.
- Sin `console.log` olvidados en el código que se publica.

## Pruebas — solo donde de verdad valen

No hace falta cobertura en todo. **Hace falta en `dominio/`, y ahí no es negociable**:
cronogramas, interés, mora, imputación y redondeo. Son funciones puras (ver
`arquitectura-app`), así que probarlas es escribir entradas y salidas esperadas.

- Cada modalidad de préstamo con un caso cuyo resultado se verificó a mano.
- Que la suma de las cuotas sea exactamente capital + interés total.
- Pago parcial, pago que cubre varias cuotas, pago adelantado, pago atrasado con mora.
- Fechas antipáticas: préstamo que vence un 31, febrero, fin de año.
- Que devengar dos veces el mismo período no duplique nada.

Un cálculo de plata sin prueba es una afirmación sin respaldo. Y el usuario va a comparar
contra su cuaderno: mejor que coincida.

## Comentarios

- Solo para explicar el **por qué** de una decisión no obvia, nunca para repetir lo que el
  código ya dice.
- Toda fórmula de cálculo financiero lleva, arriba, **de dónde sale y qué convención usa**
  (sobre saldo o sobre capital original, cómo redondea). Dentro de seis meses nadie se
  acuerda, y una fórmula de interés mal interpretada se "arregla" rompiéndola.
- Si una función necesita un comentario para explicar qué hace paso a paso, probablemente
  haya que dividirla.

## Criterios de un cambio aceptable

- Sin cálculo de plata duplicado respecto a algo que ya existe en `dominio/`.
- Todo cambio en una regla sensible (monto, tasa, mora, imputación) viene con su prueba y su
  asiento auditable.
- Sin código muerto ni comentado "por si acaso".
- Funciones cortas, una sola responsabilidad (si el nombre necesita "y", dividila).
- Si el cambio toca una convención escrita en estas reglas y la contradice, **se actualiza la
  regla en el mismo cambio**. Una regla que el código ya no cumple desorienta más de lo que
  ayuda.

## Qué NO hacer

- No repitas acá decisiones de arquitectura ni reglas de negocio: van en sus skills.
- No apruebes código que "funciona" pero esconde el error en vez de manejarlo.
- No dejes un monto en una variable que no diga que son centavos.
- No escribas una fórmula financiera sin una prueba que la verifique.
