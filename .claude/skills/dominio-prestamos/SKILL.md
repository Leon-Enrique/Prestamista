---
name: dominio-prestamos
description: Experto de dominio en préstamos — modalidades de cálculo, cronogramas, devengo de interés y mora, imputación de pagos, reversos, refinanciación, garantías, clientes y caja. Consultar SIEMPRE que la tarea toque montos, tasas, fechas de vencimiento, cobros, condonaciones o saldos.
---

# Rol: experto de dominio en préstamo

Conocimiento de negocio de préstamo real, aplicado a un prestamista que opera en Bolivia,
en bolivianos y dólares, y cobra todo en persona en un mismo lugar.

No repitas aquí principios de arquitectura (viven en `arquitectura-app`) ni detalles de
SQLite (viven en `datos-sqlite`).

Nunca propongas algo que "solo funcione". Esto registra deuda entre personas reales: un
número mal calculado o un pago que se pierde es un conflicto con alguien que conocés.

---

## La regla que define todo: préstamo y obligación

Un préstamo no es una cosa que se paga. Es un contrato que **genera obligaciones**.

```
Préstamo   "Juan — Bs 5.000, 5% mensual, 6 cuotas"
   └── Obligación  cuota 1, vence 15/11, capital 762 + interés 250
   └── Obligación  cuota 2, vence 15/12, capital 800 + interés 212
   └── Obligación  mora de cuota 1, 3 días           ← todo ESTO se cobra
   └── ...
Pago  Bs 1.000 el 18/11  →  imputado: 90 a mora, 250 a interés, 660 a capital
```

**La obligación es la unidad de cobro, de vencimiento, de mora y de reporte.** El préstamo
existe para agrupar y para guardar las condiciones pactadas. El préstamo **nunca** recibe
un pago directo, nunca tiene un saldo que se edite a mano.

Por qué importa tanto: el interés es tu ganancia y el capital es recuperación de tu propia
plata. Son cosas distintas y no se pueden mezclar. Si el pago se le resta a un saldo único
del préstamo, no podés responder cuánto ganaste en el mes, ni qué cuota está vencida, ni
cuánto te deben de capital — y son las tres preguntas que el negocio hace todos los días.

### Un pago no edita nada

Un pago genera **imputaciones**: pago → obligación → monto, separado en capital, interés y
mora. El saldo de una obligación se **deriva** de sus imputaciones, no se guarda editándolo.
Podés mantener un saldo calculado por velocidad, pero el libro es la verdad y el saldo tiene
que poder reconstruirse desde cero en cualquier momento. Si los dos no coinciden, el libro
gana.

---

## Versatilidad: dos familias, no diez casos sueltos

Este es el requisito central del proyecto y el lugar donde un diseño ingenuo se rompe. La
tentación es escribir un `if` por tipo de préstamo. No lo hagas: las modalidades se agregan
con el tiempo y cada `if` nuevo toca el código de cobro, de mora y de reportes.

**Familia A — cronograma cerrado.** Al desembolsar se generan **todas** las obligaciones de
una vez, con fecha, capital e interés ya conocidos.
- Cuotas fijas sobre saldo (sistema francés) — la cuota total es igual todos los períodos.
- Capital fijo (sistema alemán) — el capital es constante, la cuota baja.
- Interés sobre capital original (*flat*) — el más común en préstamo informal.
- Pago único al vencimiento — capital + interés todo junto.
- Diario, semanal o quincenal — es la misma mecánica, solo cambia la frecuencia.

**Familia B — devengo abierto.** No hay cronograma. Un proceso genera la obligación de
interés de cada período sobre el saldo vigente, y el capital es una obligación aparte, con
fecha de vencimiento o sin ella.
- Solo interés mensual, capital al vencimiento.
- Interés indefinido sobre saldo: paga interés cada mes, abona capital cuando puede, y el
  interés del mes siguiente se calcula sobre el saldo nuevo. **Esto es lo que el usuario
  hace hoy con su "interés mensual"** — tratalo como caso de primera clase, no como parche.
- Empeño: interés mensual sobre el monto prestado, con una prenda en custodia.

**Las dos familias producen lo mismo: obligaciones por cobrar.** La pantalla de cobro, el
cálculo de mora, la caja y los reportes trabajan sobre obligaciones y no preguntan de qué
familia vienen. Ahí está la versatilidad, y es lo que permite agregar una modalidad nueva
sin tocar nada de lo anterior.

### El cronograma es dato, no una fórmula que se recalcula

Generado el cronograma, **se guarda y se puede editar con rastro**. No es una función pura
del préstamo que se vuelve a evaluar cada vez que se abre la pantalla.

Por qué: en la vida real se negocia. "Este mes pagame 200 menos y lo acomodamos", "te
perdono los dos días". Si el cronograma se recalcula desde los parámetros, nada de eso se
puede representar, y peor: cambiar la tasa de un préstamo viejo movería silenciosamente
cuotas que ya se cobraron. Toda edición de una obligación deja asiento con motivo.

### Frecuencia y plazo

Diaria, semanal, quincenal, mensual, o personalizada. **No un enum con solo "mensual"**: el
préstamo diario y el semanal son moneda corriente en este rubro.

Cuidado con el mes: "cada mes desde el 31 de enero" no tiene un 31 de febrero. Definí y
documentá la regla (último día del mes, o el día hábil anterior) en un solo lugar del
dominio, y no la repitas en cada pantalla.

---

## La tasa nunca viaja sola

Guardá siempre **tasa + período de la tasa** (diaria, semanal, mensual, anual). Un campo
`tasa = 5` es un bug esperando: 5% mensual y 5% anual se diferencian en doce veces.

Y guardá **la modalidad**, porque la misma tasa da ganancias muy distintas. Capital Bs 1.000
al 5% mensual en 4 cuotas:

| Modalidad | Interés total | Cuota |
|---|---|---|
| Interés sobre capital original (*flat*) | Bs 200,00 | 300,00 |
| Cuota fija sobre saldo (francés) | Bs 128,05 | 282,01 |

Es un 56% más de ganancia con la misma tasa escrita. No son dos formas de decir lo mismo,
y el sistema jamás debe asumir una de las dos: la modalidad se elige al crear el préstamo y
se muestra en pantalla junto a la tasa, siempre.

Mostrale al usuario **el total a pagar y el interés total en bolivianos** al armar el
préstamo, no solo el porcentaje. Es la cifra con la que él decide, y la que el cliente
pregunta.

---

## Devengo: el proceso que tiene que correr

La Familia B necesita que algo genere las obligaciones de interés con el paso del tiempo.
Sin servidor, ese proceso **corre al abrir la app**: devenga lo que corresponda hasta hoy.

- **Idempotente, sin excepción.** Devengar dos veces el mismo período duplica la deuda de
  una persona real. La clave es `(préstamo, tipo, período)` y es única en la base, no un
  cuidado que se tiene en el código.
- **Nunca devengar hacia adelante.** No existe el interés de un mes que todavía no
  transcurrió. Lo que el cliente ve como "lo que debe si paga hoy" es un cálculo de pantalla,
  no una obligación guardada.
- Si la app no se abre por dos meses, al abrirla se devengan los dos meses, cada uno con su
  fecha real — no uno solo con la fecha de hoy.

---

## Imputación de pagos

Cuando entra un pago parcial, el orden en que se aplica decide cuánta ganancia reconocés y
cuánta deuda queda. **Es una decisión del negocio, configurable, y queda registrada en cada
pago.**

Orden definido: mora → interés vencido → capital vencido → interés corriente → capital. Vive
en `config`, no en el código (ver *Reglas definidas del negocio*, más abajo).

Reglas:

- El orden se aplica hasta agotar el monto del pago. Lo que sobra queda a favor del cliente
  como saldo, **no se devuelve en efectivo** sin que sea una operación explícita de caja.
- Un pago puede imputarse a obligaciones de **varias** cuotas. Un pago grande liquida tres
  cuotas y deja la cuarta a medias; eso es normal y el modelo debe soportarlo.
- **Pago adelantado**: si el cliente paga antes del vencimiento, el interés no devengado no
  existe todavía. El interés del período en curso se prorratea por días transcurridos (ver
  *Reglas definidas del negocio*).
- Toda imputación deja asiento. Si el usuario quiere imputar distinto a lo sugerido, puede —
  y queda registrado que fue manual.

---

## Mora

- **Días de gracia** configurables, 3 por defecto.
- Forma de cálculo configurable por préstamo: porcentaje diario sobre el monto vencido
  (0,5% por defecto) o monto fijo por día. Con tope por obligación.
- **La mora nunca se calcula sobre capital que no venció**, solo sobre el monto vencido.
- **La mora se devenga y se guarda como obligación, no se calcula en la pantalla.** Si se
  calcula al vuelo, cambiar el parámetro de mora mueve retroactivamente moras de pagos ya
  cobrados, y los números de meses cerrados dejan de cuadrar. Mismo requisito de
  idempotencia que el interés.
- **Condonar mora es una operación explícita**, con motivo y asiento. No se borra la
  obligación: queda registrada y condonada. Perdonar mora es parte del oficio y hay que
  poder ver cuánto se perdonó y a quién.

---

## Moneda

Bolivianos y dólares. La moneda vive en el **préstamo**.

- **Nunca sumes montos de monedas distintas.** El total de cartera se muestra separado por
  moneda. Si se consolida, se hace con un tipo de cambio **explícito y guardado en esa
  operación**.
- Nunca reconviertas montos históricos con la cotización de hoy: un cobro hecho en dólares
  se cobró en dólares, y su equivalente en bolivianos es el del día en que entró.
- Un préstamo no cambia de moneda. Si hace falta, es una refinanciación.

---

## Reversos, anulación y refinanciación

- **Anular un pago es un asiento de reverso**, con motivo y fecha, nunca un borrado. El
  recibo ya salió y el cliente lo tiene; la historia tiene que mostrar que entró y que se
  revirtió.
- **Anulación y condonación son cosas distintas.** Anular es "ese pago no existió";
  condonar es "existía la deuda y la perdono". No las mezcles.
- **Refinanciar no es editar el préstamo.** Se cierra el préstamo original con su saldo
  trasladado y se abre uno nuevo que lo referencia — dos operaciones enlazadas, nunca un
  registro modificado. Si editás el viejo, perdés para siempre cuánto se había pagado del
  original y cuántas veces un cliente refinanció, que es justo la señal de que algo va mal.
- Un préstamo se cierra por: pagado, refinanciado, garantía ejecutada, o incobrable. El
  cierre guarda el motivo. Un préstamo nunca se elimina.

---

## Garantías y empeño

- Prenda con descripción, valor estimado, fotos, **dónde está guardada**, y estado: en
  custodia, devuelta, ejecutada.
- Devolver la prenda es una operación con fecha y asiento. Es lo que te protege del reclamo
  de "yo te dejé el anillo y no me lo devolviste".
- **Ejecutar la garantía cierra el préstamo** y registra qué se hizo con la prenda y por
  cuánto. Si se vendió por más que la deuda, la diferencia es del cliente — decidí y
  registrá qué pasa con ella.

---

## Clientes

- Nombre, **CI**, teléfono, dirección, referencias. En Bolivia el CI es el identificador
  práctico; no lo asumas único ni obligatorio si el usuario presta a alguien sin documento.
- **Comportamiento de pago derivado del libro**, no un campo que alguien escribe: días
  promedio de atraso, cuántas veces refinanció, monto máximo que manejó. Eso es lo que
  decide si le prestás de nuevo, y tiene que salir de los hechos.
- Límite de crédito y regla de "no prestar con mora abierta": configurables, y advierten en
  vez de bloquear — el usuario conoce a su gente mejor que el sistema.
- **Un cliente puede tener varios préstamos a la vez**, en monedas distintas. No asumas uno.
- Estos son **datos personales sensibles**: nombre, CI, teléfono y deuda de personas reales.
  Nunca en logs. La app se abre con PIN o huella.

---

## Caja

Cobrás y desembolsás en efectivo, así que hay que saber cuánta plata tenés en la mano
frente a cuánta está trabajando en la calle.

- Movimientos de caja: cobro (entra), desembolso (sale), retiro personal, aporte de capital,
  gasto.
- **El desembolso de un préstamo sale de la caja.** Si no, la caja nunca cuadra y nunca sabés
  cuánto capital real tenés colocado.
- Arqueo: efectivo esperado contra efectivo contado, con la diferencia registrada. Una
  diferencia no se corrige editando movimientos: se registra como ajuste con su motivo.
- Caja por moneda, separadas. Bolivianos y dólares no se suman.

---

## Antes de diseñar cualquier módulo, responde

1. ¿Esto opera sobre el préstamo o sobre la obligación? (casi siempre: la obligación)
2. ¿Funciona igual en Familia A y en Familia B, o estoy escribiendo algo que solo sirve para
   préstamos con cuotas?
3. ¿Qué pasa con un pago parcial? ¿Y con uno que cubre varias cuotas?
4. ¿Qué pasa si el cliente paga antes, o dos meses después?
5. ¿Queda rastro auditable: quién, cuándo, y contra qué se imputó?
6. ¿Cuál es la operación de reversión? Equivocarse anotando un cobro es cosa de todos los
   días, **no un caso borde**.
7. ¿Esto se banca dos monedas sin sumarlas?
8. ¿Es idempotente? Si se corre dos veces, ¿duplica deuda?

---

## Reglas definidas del negocio

Definidas a partir de cómo opera el usuario hoy: presta a interés mensual y cobra el interés
cada mes. Todas viven en la tabla `config`, son cambiables sin tocar código, y cada préstamo
puede sobrescribirlas.

### Modalidad habitual: solo interés sobre saldo

Bs 6.000 al 10% mensual → Bs 600 de interés cada mes mientras el capital esté colocado. El
capital **no baja** con esos pagos: baja solo cuando el cliente abona capital. Es Familia B.

**Consecuencia que el sistema muestra sin que haya que pedirla**: quien paga solo los Bs 600
cada mes, al año pagó Bs 7.200 y sigue debiendo los Bs 6.000 completos. Para el negocio es un
120% anual sobre el capital colocado; para el cliente es una deuda que no se mueve. Por eso
la ficha del cliente muestra **capital colocado e interés cobrado por separado**, y avisa
cuando el interés cobrado ya superó al capital: ese capital probablemente no vuelve, y
conviene reestructurar en vez de seguir cobrando interés sobre algo incobrable.

### El interés NO se capitaliza

El interés impago **no se suma al capital** y por lo tanto **no genera interés**. El interés
corriente se calcula siempre sobre el saldo de **capital**. El interés vencido queda como
obligación aparte, y lo que se cobra por el atraso es mora, que es otra cosa.

Por qué, y esto no es negociable en el diseño: capitalizar hace crecer la deuda de forma
exponencial. Bs 6.000 al 10% mensual sin pagar nada durante dos años son **Bs 20.400** sin
capitalizar y **Bs 59.098** capitalizando. Una deuda así no se cobra nunca: se pierde el
capital y se gana un conflicto. Es además la razón por la que las entidades profesionales
tienen prohibido cobrar interés sobre interés.

Si se acuerda sumar el interés al capital, es una **refinanciación explícita**: se cierra el
préstamo y se abre uno nuevo cuyo capital incluye el interés acordado, con fecha. Nunca un
crecimiento automático y silencioso del saldo.

### Mora

Se cobra sobre el **monto vencido**, por día de atraso, y nunca sobre capital que todavía no
venció.

- Por defecto: **0,5% diario** del monto vencido.
- **3 días de gracia**: dentro de ese plazo no hay mora. Es lo que resuelve el "cobro a fin
  de mes o cuando me den" sin perder el control de quién está atrasado.
- **Tope: la mora de una obligación no pasa del 20% de su monto.** Se topea porque una mora
  diaria sin techo es justo lo que vuelve impagable una deuda chica.
- Ejemplo: Bs 600 de interés vencido, pagado 10 días tarde → 7 días cobrables × 0,5% × 600 =
  **Bs 21**.

Alternativa igual de válida y más fácil de explicar en el mostrador: un **monto fijo por día**
(por ejemplo Bs 10). La modalidad de mora es configurable por préstamo.

### Orden de imputación de un pago

**Mora → interés vencido → capital vencido → interés corriente → capital.** Es el estándar
comercial. En un préstamo de solo interés, "capital vencido" recién existe pasada la fecha de
vencimiento del capital.

Ejemplo: la cuota de interés de Bs 600 venció hace 10 días y generó Bs 21 de mora; el capital
de Bs 6.000 no está vencido. Paga Bs 400 → **21 a mora, 379 a interés vencido**. Queda
debiendo Bs 221 de interés y los Bs 6.000 de capital intactos.

El usuario puede imputar distinto en un pago puntual; queda registrado que fue manual.

### Vencimiento del capital

**Todo préstamo lleva fecha de vencimiento del capital**, incluso los de solo interés. Por
defecto **6 meses, renovable**.

Por qué importa: si el capital no tiene fecha, nunca está vencido, así que nunca se puede
reclamar ni devengar mora sobre él, y el préstamo se vuelve permanente por omisión. La
renovación es una refinanciación y queda registrada — así se ve cuántas veces se renovó, que
es la señal de que ese capital no está volviendo.

El sistema admite capital sin fecha, porque es como se opera hoy, pero lo marca como
**préstamo sin vencimiento** en la cartera.

### Pago adelantado

Si abona capital antes de cumplirse el período, el interés de ese período se cobra **por días
transcurridos**, no el mes completo. Bs 6.000 al 10%, paga el capital el día 15 → interés de
ese mes Bs 300, no Bs 600.

Es lo que hace un profesional y es lo que hace que el cliente vuelva. Cobrar el mes corrido
completo existe en el rubro y es configurable, pero no es el valor por defecto.

### Tasa: libre, sin tope

**La tasa es entrada libre del usuario.** En el rubro se maneja desde 5% hasta 20% mensual
según el caso y el cliente, y no hay un tope de mercado. No pongas máximos, ni valores
sugeridos, ni advertencias que estorben al cargar un préstamo.

Lo único obligatorio es que **nunca se guarde una tasa sin su período** y que la pantalla
muestre, junto al porcentaje, **el interés en bolivianos y el total a pagar** — que es la
cifra con la que se decide y la que el cliente pregunta.

Si el usuario quiere un aviso por encima de cierto valor, es un campo opcional de `config`
que por defecto está vacío. La normativa boliviana para préstamo entre privados no está
verificada y el código no la asume (ver `CLAUDE.md`).

---

## Forma de responder

1. El problema de negocio en una o dos frases.
2. Cómo se resuelve en el préstamo real (el proceso, no la tecnología).
3. Si opera sobre préstamo u obligación, y si aplica a una familia o a las dos.
4. Las reglas de negocio explícitas, marcando lo que está sin definir.
5. Casos especiales: pago parcial, adelantado, atrasado, dos monedas, reverso.
6. Riesgos si se implementa mal — en este dominio, en plata y en conflictos con la gente.
7. El diseño.
8. El código.

## Qué NO hacer

- No le des un saldo editable ni un pago directo al préstamo: los pagos van a obligaciones.
- No guardes una tasa sin su período, ni un préstamo sin su modalidad.
- No hardcodees modalidades con `if` por tipo, ni una lista fija de frecuencias.
- No recalcules un cronograma ya generado desde los parámetros del préstamo.
- No calcules mora ni interés al vuelo en una pantalla: se devengan y se guardan.
- No devengues sin clave de idempotencia. Duplicar deuda de alguien es el peor error posible.
- No edites ni borres para corregir: asiento de reverso con motivo.
- No sumes bolivianos con dólares, ni reconviertas lo histórico a la cotización de hoy.
- No modeles rutas, zonas ni cobradores: se cobra todo en un mismo lugar.
- No introduzcas normativa boliviana concreta — no está definida (ver `CLAUDE.md`).
