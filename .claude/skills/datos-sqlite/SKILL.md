---
name: datos-sqlite
description: SQLite en el dispositivo con expo-sqlite — modelado de préstamos y obligaciones, dinero en centavos enteros, fechas, libro de solo inserción, migraciones y respaldo. Consultar al crear o cambiar tablas, escribir consultas, o tocar el respaldo.
---

# SQLite en el dispositivo (expo-sqlite)

La base de datos es **un archivo dentro del celular**. No hay servidor, no hay otra copia, y
el usuario no tiene laptop. Diseñá con eso presente: el esquema tiene que poder evolucionar
sobre datos reales que no se pueden perder ni volver a cargar.

Las reglas de negocio están en `dominio-prestamos`; acá está cómo se materializan en tablas.

---

## Dinero: enteros en centavos, nunca decimales

**Regla obligatoria, sin excepciones.** Todo monto se guarda como `INTEGER` en centavos y se
maneja como entero en TypeScript. Nunca `REAL` en una columna de plata, nunca un decimal en
una suma o comparación.

En punto flotante `0.1 + 0.2` no da `0.3`. En un sistema que suma miles de pagos y hace
arqueos de caja contra efectivo contado, ese error se acumula hasta que la caja no cuadra —
y nadie va a sospechar del tipo de dato. Los enteros de JavaScript son exactos hasta 2^53,
que en centavos son más de noventa billones: de sobra.

El tipo `Dinero` vive en `nucleo/` y lleva su moneda adentro. **Sumar dos `Dinero` de monedas
distintas tiene que ser un error**, no una suma silenciosa.

### Redondeo

El redondeo se decide **una vez, en `dominio/`**, y se documenta. Regla práctica del rubro:
calculá cada cuota redondeada y **mandá la diferencia a la última cuota**, de modo que la
suma de las cuotas sea exactamente capital + interés total.

Si redondeás cada cuota y no ajustás, el cronograma no cierra y el cliente queda debiendo
Bs 0,03 para siempre — una obligación de tres centavos que ensucia la mora, los reportes y
la relación con la persona.

---

## Fechas: un vencimiento no es un instante

Dos tipos distintos, y confundirlos corre los vencimientos un día:

- **Día de calendario** (vencimiento, fecha de un cobro): texto `YYYY-MM-DD`. Sin hora, sin
  zona. El 15 de noviembre es el 15 de noviembre.
- **Instante** (`creado_en`, `revertido_en`): ISO-8601 completo con zona.

Bolivia es UTC−4. Si guardás un vencimiento como instante, el 15 a las 00:00 local se
convierte en el 14 a las 20:00 UTC, y el día que muestres o compares contra UTC vas a ver
vencimientos corridos un día — con mora cobrada de más a gente real. Guardá los días como
texto plano y comparalos como texto: en `YYYY-MM-DD` el orden alfabético **es** el orden
cronológico.

---

## Modelado

```
clientes          → nombre, ci, teléfono, dirección, referencias
prestamos         → cliente, capital, moneda, tasa + periodo_tasa, modalidad,
                    frecuencia, fecha_desembolso, estado, prestamo_origen_id
obligaciones      → prestamo, tipo (cuota|interes|mora), vencimiento (día),
                    monto_capital, monto_interes, periodo, estado   ← se cobra ESTO
pagos             → fecha (día), monto, moneda, medio, creado_en
imputaciones      → pago, obligacion, capital, interes, mora
movimientos       → libro de solo inserción (ver abajo)
garantias         → prestamo, descripción, valor_estimado, ubicación, estado
caja_movimientos  → tipo, monto, moneda, referencia, fecha
config            → clave/valor: orden de imputación, días de gracia, tope de tasa
```

Reglas:

- **Toda FK de pago e imputación apunta a `obligaciones`, nunca a `prestamos`.** Si escribís
  `prestamo_id` en una tabla de imputación, está mal (ver `dominio-prestamos`).
- `obligaciones` lleva **índice único `(prestamo_id, tipo, periodo)`** para los devengos. Esa
  restricción en la base es lo que hace imposible duplicar la deuda de alguien, y no se
  reemplaza con un chequeo en el código.
- Índices en lo que se filtra todos los días: `obligaciones(vencimiento, estado)`,
  `obligaciones(prestamo_id)`, `prestamos(cliente_id, estado)`, `pagos(fecha)`.
- `CHECK (monto > 0)` en pagos e imputaciones. Un pago de cero o negativo es un reverso, y
  el reverso tiene su propio asiento.
- La moneda se guarda en el préstamo y se **repite** en el pago y en el movimiento de caja.
  Es redundante a propósito: así una consulta de caja no necesita un `JOIN` hasta el préstamo
  para no sumar peras con manzanas.
- **Soft delete en todo.** Un cliente o un préstamo nunca se borra: cambia de estado con
  motivo. Un préstamo cerrado sigue apareciendo en el historial, y por eso existe.

## El libro es de solo inserción

`movimientos` registra: desembolso, devengo de interés, devengo de mora, pago, imputación,
condonación, reverso, refinanciación, ajuste de caja.

**Nunca `UPDATE`, nunca `DELETE` sobre `movimientos`.** Un error se corrige con un asiento
de reverso que apunta al original. Esto no es purismo contable: es un registro de deuda
entre personas, y la única defensa cuando alguien dice "yo te pagué" es un libro que no se
pudo editar.

Los saldos son **derivados**. Podés guardar un saldo calculado por velocidad, pero tiene que
poder reconstruirse desde los movimientos en cualquier momento, y debe existir una pantalla
o un script que verifique que coinciden.

## Transacciones

Desembolsar, cobrar, refinanciar y devengar escriben varias filas. **Todo dentro de una
transacción.** Un cobro que insertó el pago pero no sus imputaciones deja la cartera
inconsistente, y en un celular la app se puede cerrar en cualquier momento — batería,
llamada entrante, el sistema matando la app en segundo plano.

No hay concurrencia real (un solo usuario, un solo dispositivo), así que no hace falta
bloqueo de filas. Lo que sí hace falta es que cada operación sea atómica.

### Nunca uses `withExclusiveTransactionAsync`

Parece la opción correcta —la documentación la recomienda cuando importa el orden— y es una
trampa doble. Abre una **conexión nueva** (su `Transaction` extiende `SQLiteDatabase`), y eso
trae dos problemas:

1. **Se cuelga.** Pide un `BEGIN EXCLUSIVE` desde la segunda conexión mientras la principal
   ya tiene el WAL activo, y se queda esperando un candado que no llega. Sin error, sin
   timeout: la app se queda cargando para siempre. Nos pasó al arrancar por primera vez en el
   celular, con las migraciones.
2. **Apaga las claves foráneas.** `PRAGMA foreign_keys` es por conexión y es un **no-op dentro
   de una transacción**, así que en esa conexión nueva están apagadas y no se pueden encender.

**Todo va con `withTransactionAsync` sobre la conexión principal**, que es donde
`foreign_keys = ON` rige: las migraciones en `migrador.ts` y las operaciones de negocio a
través de `enTransaccion()` de `datos/base.ts`. La app es de un solo usuario y hace una
operación a la vez, así que la exclusividad no compra nada.

`journal_mode = WAL` y `foreign_keys` van **fuera de toda transacción**, al abrir la base:
cambiar el modo de journal adentro falla, y el de claves foráneas no hace nada.

## Cómo se prueba el esquema

Las pruebas del esquema corren con **`node:sqlite`** (viene con Node, sin instalar nada),
no con expo-sqlite, que solo funciona en el dispositivo. Un adaptador de cuatro métodos
alcanza para que las migraciones corran igual, y el SQL es el mismo — ver
`datos/esquema.test.ts`.

Esto cubre lo que `pre-release` pide verificar: que los `CHECK` y las restricciones de
unicidad **existen realmente en la base** y no solo en el código. Toda migración nueva suma
sus pruebas ahí; es la forma de no descubrir en el celular que un `CHECK` estaba mal escrito.

---

## Migraciones

No hay Alembic acá. Hace falta un corredor de migraciones propio, y es código de la primera
semana, no algo que se agrega después.

1. `PRAGMA user_version` guarda la versión aplicada.
2. Las migraciones son un arreglo numerado, **solo hacia adelante**, y se aplican en orden al
   abrir la app, **cada una en su transacción**.
3. **Jamás "borrar y recrear" el esquema.** Ahí vive la cartera. Es la diferencia entre un
   proyecto de juguete y uno con los datos de alguien adentro.
4. Una migración que mueve datos trae su lógica escrita, no deja filas huérfanas.
5. Antes de aplicar una migración que mueve datos, **se toma un respaldo automático** y se
   conserva hasta que el usuario confirme que todo está bien.
6. SQLite no tiene todos los `ALTER TABLE`. Para cambios grandes: tabla nueva, copiar datos,
   renombrar. Escribilo explícito en la migración.

---

## Respaldo — la contracara de ser local-first

Elegir SQLite en el celular compró simplicidad y costo cero. El precio es este, y hay que
pagarlo bien: **un celular perdido, robado o mojado sin respaldo es la cartera entera
perdida**, sin forma de recuperarla.

- El respaldo es **el archivo de la base**, exportable por el menú de compartir del sistema
  (WhatsApp, Drive, correo) con `expo-file-system` + `expo-sharing`.
- **Respaldo automático**: al cerrar el día, o al salir de la app si hubo movimientos.
  Conservar las últimas N copias, no solo la última: una base corrupta sobrescribiendo la
  única copia buena es peor que no tener respaldo.
- **Aviso visible y molesto** si hace más de N días que no se exportó un respaldo fuera del
  dispositivo. Una copia que vive solo en el mismo celular no es un respaldo.
- Exportar además una versión **legible** (CSV o JSON) de clientes, préstamos y pagos. Si
  algún día la app no abre o se cambia de sistema, el usuario tiene que poder leer su cartera
  sin esta app.
- **Restaurar tiene que estar implementado y probado.** Un respaldo que nunca restauraste no
  es un respaldo: es un archivo. Ver `pre-release`.

---

## Evitar

- `REAL` en cualquier columna de plata.
- Guardar un vencimiento como instante con zona.
- `UPDATE` o `DELETE` sobre `movimientos`.
- Operaciones de varios pasos fuera de una transacción.
- Devengos sin el índice único de idempotencia.
- Consultas armadas con interpolación de strings — parámetros siempre.
- Lógica de negocio en triggers de SQLite.
- Borrado físico de clientes, préstamos u obligaciones.
- Cambiar el esquema a mano sin su migración numerada.
