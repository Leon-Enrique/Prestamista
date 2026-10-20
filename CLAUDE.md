# Prestamista — app de gestión de préstamos

Una sola app móvil. **No es un monorepo**: todo vive en este proyecto.

Stack: **Expo / React Native + TypeScript**, con **SQLite en el dispositivo**.
Cobro, cartera, caja, reportes y configuración son pantallas de la misma app.

## Decisiones tomadas, y por qué

- **Local-first.** La base de datos es un archivo SQLite dentro del celular. No hay
  servidor, no hay costo mensual y funciona sin señal — que es lo que importa cuando se
  cobra en persona. El precio de esta decisión es que **el respaldo no es opcional**: si se
  pierde el teléfono sin respaldo, se pierde la cartera entera. Ver `datos-sqlite`.
- **Sin web pública ni panel aparte.** El control y los reportes son pantallas de la app.
- **Un solo usuario.** Sin login de cuenta ni roles. La app se protege con PIN o huella al
  abrir, porque contiene deudas de personas reales. Todo movimiento se graba con fecha y
  hora igual, y con un campo de autor, para que agregar una segunda persona después no
  obligue a rehacer la auditoría.
- **Expo, no Flutter.** Con Expo Go se prueba en el celular al instante y el APK se compila
  en la nube con EAS, sin Android Studio en ninguna PC. Decisivo cuando la única pantalla
  disponible es el teléfono.

## Negocio

Prestamista en **Bolivia**. Presta en **bolivianos y en dólares** — la moneda vive en cada
préstamo, nunca es una constante global. Se cobra todo en un mismo lugar: **no hay rutas ni
cobradores**, así que no modeles zonas, hojas de ruta ni liquidación de cobrador.

Toda clase de préstamo, y **la versatilidad es un requisito, no un adorno**: cuotas fijas,
interés mensual sobre saldo, interés sobre capital original, solo interés con capital
abierto, pago único al vencimiento, empeño con garantía. El detalle está en
`dominio-prestamos`.

## Regla estructural que atraviesa todo

La **obligación** —una cuota, un interés devengado o una mora de un período— es la unidad
de cobro. El **préstamo** agrupa obligaciones, pero **nunca se paga directamente**: un pago
se imputa contra obligaciones concretas, separando capital, interés y mora.

Si estás por restarle un monto al saldo del préstamo sin pasar por sus obligaciones, algo
está mal: se perdió la única forma de responder "¿qué cuota está vencida?" y "¿cuánto de lo
que cobré es ganancia y cuánto es recuperación de capital?", que son *las* preguntas del
negocio.

## Convenciones transversales

- Naming: negocio en español; infraestructura de framework en inglés (ver `calidad-codigo`).
- **Dinero: enteros en centavos, siempre.** Nunca decimales para sumar o comparar
  (ver `datos-sqlite`).
- **Una tasa nunca viaja sola**: siempre tasa + su período. "5%" no significa nada.
- **El libro de movimientos es de solo inserción.** Un error se corrige con un asiento de
  reverso, nunca editando ni borrando.
- Fecha de vencimiento es un **día de calendario**; fecha de un evento es un **instante**.
  No son el mismo tipo y confundirlos corre los vencimientos un día (ver `datos-sqlite`).

## Normativa — sin definir

Bolivia está definido como país; **la normativa no**. Tope legal de tasa, tratamiento
impositivo y requisitos de contrato **no están definidos**. No introduzcas ningún número ni
texto legal concreto sin que el usuario lo haya definido. El tope de tasa es un valor
configurable que dispara una advertencia, no una constante en el código.

Esta app es una herramienta de **registro personal**. No generes documentos que se
presenten como oficiales de una entidad financiera, ni textos que parezcan asesoría legal.

## Fuera de alcance, y la razón

**Agente de reportes en lenguaje natural.** En un proyecto con servidor tiene sentido,
porque la clave de la API vive en el servidor. Acá no hay servidor: la clave terminaría en
el celular, donde cualquiera que abra el APK la puede leer y gastar la cuota. Si algún día
se quiere, primero hace falta un backend mínimo. **No lo implementes con la clave en el
dispositivo.** Los reportes se hacen con consultas SQLite normales, que para esta escala
alcanzan de sobra.
