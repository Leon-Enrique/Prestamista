---
name: pre-release
description: Checklist obligatorio antes de instalar la app en el celular para usarla con plata real, y antes de cada APK nuevo. Consultar cuando el usuario mencione compilar, APK, EAS, instalar, publicar o empezar a usarla en serio.
---

# Antes de usar la app con plata real

Esto no se expone a internet, así que el riesgo no es un atacante: es **perder la cartera o
calcular mal**. Revisar cada punto con el usuario.

## Bloqueantes — datos

- [ ] **Restauración probada de verdad.** Exportar un respaldo, borrar la app, reinstalar,
      restaurar, y verificar que están todos los préstamos y pagos. Un respaldo que nunca
      restauraste es un archivo, no un respaldo. Esto es el punto número uno de la lista
      porque es el único error del que no hay vuelta atrás.
- [ ] Respaldo automático funcionando, conservando varias copias (no solo la última).
- [ ] El aviso de "hace N días que no respaldás" aparece y se entiende.
- [ ] Exportación legible (CSV o JSON) probada: el usuario puede abrir su cartera sin la app.
- [ ] Toda migración nueva tiene su prueba **sobre datos ya cargados**, no sobre una base
      vacía: una migración que anda en limpio y rompe con datos adentro es el caso normal.
      `crearBaseDePrueba({ hastaVersion: N })` deja la base en el esquema anterior para eso;
      el ejemplo es `datos/migracion002.test.ts`, que verifica que no se pierde ni una fila,
      que no quedan referencias huérfanas y que los índices se vuelven a crear.
- [ ] El respaldo previo a migrar se toma solo (está en `abrirBase()`), pero **verificá que el
      archivo aparece** en la lista de Ajustes después de actualizar la app.

## Bloqueantes — cálculos

- [ ] **Un mes en paralelo con el cuaderno.** Anotar en los dos y comparar al cierre: saldos,
      interés cobrado, mora. Si no coincide, no se confía en la app todavía. Es la única
      prueba que importa, porque el cuaderno es la verdad conocida.
- [ ] Cada modalidad de préstamo verificada a mano con un caso real.
- [ ] La suma de las cuotas da exactamente capital + interés total, sin centavos colgados.
- [ ] Devengar dos veces (abrir y cerrar la app varias veces el mismo día) **no duplica**
      interés ni mora.
- [ ] Bolivianos y dólares nunca aparecen sumados en la misma cifra, en ninguna pantalla.
- [ ] Un reverso de pago deja los saldos exactamente como estaban antes.
- [ ] Los saldos derivados coinciden con el libro de movimientos recalculado desde cero.

## Datos personales

- [ ] PIN o huella al abrir, activado y probado. La app tiene nombres, CI, teléfonos y deudas
      de personas reales.
- [ ] Ningún dato personal ni monto identificable en los logs.
- [ ] Los respaldos salen del dispositivo por donde el usuario decida — y él sabe que ese
      archivo contiene todos los datos de su gente, así que dónde lo guarda importa.

## App

- [ ] Probada **con el modo avión prendido**: la app es local, tiene que funcionar completa
      sin señal. Si algo falla sin internet, es un dependencia que no debería estar.
- [ ] Probada con la app cerrada a la fuerza en medio de un cobro: no quedan pagos sin sus
      imputaciones (transacciones, ver `datos-sqlite`).
- [ ] Probada en el celular real del usuario, no solo en emulador: el tamaño de pantalla y
      los dedos son parte de la prueba.
- [ ] Los montos se leen de un vistazo y los botones se tocan sin apuntar. Se usa de pie,
      con alguien esperando enfrente.
- [ ] Fecha y hora del dispositivo: si el usuario la cambia, ¿qué pasa con los devengos? Al
      menos no debe duplicar ni borrar nada.

## Compilación y entrega

- [ ] APK compilado con EAS Build e instalado en el celular. Probar que instala sobre la
      versión anterior **sin perder la base de datos** — es el error clásico y se verifica
      una vez por cada versión nueva.
- [ ] Versión visible en alguna pantalla, para saber qué está corriendo cuando algo falle.
- [ ] Nada de claves de servicios en el bundle: todo lo que va en el APK lo puede leer
      cualquiera (ver `CLAUDE.md`, sección fuera de alcance).

## Reglas del negocio

Están definidas en `dominio-prestamos`. Lo que hay que verificar antes de usar la app:

- [ ] Los valores viven en la tabla `config`, no escritos en el código.
- [ ] Interés corriente calculado sobre el saldo de **capital**, y el interés impago **no**
      capitaliza. Probado con un préstamo al que no se le pagó nada durante seis meses: debe
      dar capital + seis intereses, no un saldo compuesto.
- [ ] Mora solo sobre el monto vencido, respetando los días de gracia y el tope por
      obligación. Probada con un pago 10 días tarde.
- [ ] Orden de imputación mora → interés vencido → capital vencido → interés corriente →
      capital, verificado con un pago parcial.
- [ ] Interés prorrateado por días cuando se abona capital antes del vencimiento.
- [ ] Todo préstamo tiene fecha de vencimiento del capital, o está marcado como préstamo sin
      vencimiento en la cartera.
- [ ] La ficha del cliente muestra capital colocado e interés cobrado por separado, y avisa
      cuando el interés cobrado superó al capital.
- [ ] La tasa es entrada libre, sin máximo ni advertencia que estorbe (5% a 20% mensual es
      rango normal del rubro), y la pantalla muestra el interés en bolivianos junto al %.
