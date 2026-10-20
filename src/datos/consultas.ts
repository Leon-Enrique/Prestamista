/**
 * Consultas de lectura para las pantallas.
 *
 * Agregan en SQL en vez de traer todas las obligaciones y sumarlas en JavaScript: la
 * pantalla de cartera se abre muchas veces por día y tiene que aparecer al instante.
 *
 * Nada de reglas de negocio acá. El único criterio que se repite —"saldo es lo pactado menos
 * lo pagado"— está en `dominio/obligaciones.ts` para una obligación suelta; esto es la misma
 * resta hecha en bloque, y las pruebas verifican que los dos caminos dan igual.
 */

import { dinero, type Dinero, type Moneda } from '../nucleo/dinero';
import { diasEntre, type Dia } from '../nucleo/fechas';
import type { EstadoPrestamo, Modalidad } from '../dominio/tipos';
import type { EjecutorSQL } from './ejecutor';

/** Lo pactado menos lo cobrado, para las tres componentes. */
const SALDO = `
  (o.capital_centavos + o.interes_centavos + o.mora_centavos
   - o.pagado_capital_centavos - o.pagado_interes_centavos - o.pagado_mora_centavos)
`;

const COBRABLES = "o.estado IN ('pendiente', 'parcial')";

export type ResumenPrestamo = {
  readonly prestamoId: number;
  readonly clienteId: number;
  readonly cliente: string;
  readonly telefono: string | null;
  readonly moneda: Moneda;
  readonly modalidad: Modalidad;
  readonly estado: EstadoPrestamo;
  readonly saldo: Dinero;
  readonly vencido: Dinero;
  readonly mora: Dinero;
  /** El primer vencimiento sin pagar: lo que hay que cobrar a continuación. */
  readonly proximoVencimiento: Dia | null;
  readonly diasDeAtraso: number;
};

type FilaResumen = {
  prestamo_id: number;
  cliente_id: number;
  cliente: string;
  telefono: string | null;
  moneda: string;
  modalidad: string;
  estado: string;
  saldo_centavos: number | null;
  vencido_centavos: number | null;
  mora_centavos: number | null;
  proximo_vencimiento: string | null;
  vencimiento_mas_viejo: string | null;
};

function aResumen(fila: FilaResumen, hoy: Dia): ResumenPrestamo {
  const moneda = fila.moneda as Moneda;
  return {
    prestamoId: fila.prestamo_id,
    clienteId: fila.cliente_id,
    cliente: fila.cliente,
    telefono: fila.telefono,
    moneda,
    modalidad: fila.modalidad as Modalidad,
    estado: fila.estado as EstadoPrestamo,
    saldo: dinero(fila.saldo_centavos ?? 0, moneda),
    vencido: dinero(fila.vencido_centavos ?? 0, moneda),
    mora: dinero(fila.mora_centavos ?? 0, moneda),
    proximoVencimiento: (fila.proximo_vencimiento as Dia | null) ?? null,
    diasDeAtraso: fila.vencimiento_mas_viejo
      ? Math.max(0, diasEntre(fila.vencimiento_mas_viejo as Dia, hoy))
      : 0,
  };
}

const CONSULTA_RESUMEN = `
  SELECT
    p.id         AS prestamo_id,
    p.cliente_id AS cliente_id,
    c.nombre     AS cliente,
    c.telefono   AS telefono,
    p.moneda     AS moneda,
    p.modalidad  AS modalidad,
    p.estado     AS estado,
    SUM(${SALDO})                                                        AS saldo_centavos,
    SUM(CASE WHEN o.vencimiento < ? THEN ${SALDO} ELSE 0 END)            AS vencido_centavos,
    SUM(o.mora_centavos - o.pagado_mora_centavos)                        AS mora_centavos,
    MIN(o.vencimiento)                                                   AS proximo_vencimiento,
    MIN(CASE WHEN o.vencimiento < ? THEN o.vencimiento END)              AS vencimiento_mas_viejo
  FROM prestamos p
  JOIN clientes c ON c.id = p.cliente_id
  LEFT JOIN obligaciones o ON o.prestamo_id = p.id AND ${COBRABLES}
`;

/**
 * Los préstamos activos con deuda, lo más urgente primero.
 *
 * Es la pantalla de inicio: lo primero que se ve al abrir la app es a quién hay que cobrarle
 * hoy y quién está atrasado.
 */
export async function carteraActiva(db: EjecutorSQL, hoy: Dia): Promise<ResumenPrestamo[]> {
  const filas = await db.getAllAsync<FilaResumen>(
    `${CONSULTA_RESUMEN}
     WHERE p.estado = 'activo'
     GROUP BY p.id
     HAVING saldo_centavos > 0
     ORDER BY vencido_centavos DESC, proximo_vencimiento IS NULL, proximo_vencimiento,
              c.nombre COLLATE NOCASE`,
    hoy,
    hoy,
  );
  return filas.map((fila) => aResumen(fila, hoy));
}

export async function prestamosDeCliente(
  db: EjecutorSQL,
  clienteId: number,
  hoy: Dia,
): Promise<ResumenPrestamo[]> {
  const filas = await db.getAllAsync<FilaResumen>(
    `${CONSULTA_RESUMEN}
     WHERE p.cliente_id = ?
     GROUP BY p.id
     ORDER BY p.estado = 'activo' DESC, p.fecha_desembolso DESC, p.id DESC`,
    hoy,
    hoy,
    clienteId,
  );
  return filas.map((fila) => aResumen(fila, hoy));
}

export async function resumenDePrestamo(
  db: EjecutorSQL,
  prestamoId: number,
  hoy: Dia,
): Promise<ResumenPrestamo | null> {
  const fila = await db.getFirstAsync<FilaResumen>(
    `${CONSULTA_RESUMEN} WHERE p.id = ? GROUP BY p.id`,
    hoy,
    hoy,
    prestamoId,
  );
  return fila ? aResumen(fila, hoy) : null;
}

// --- Totales ---------------------------------------------------------------------------

export type TotalPorMoneda = {
  readonly moneda: Moneda;
  readonly prestamos: number;
  readonly saldo: Dinero;
  readonly vencido: Dinero;
};

/** Totales de la cartera, **separados por moneda**: bolivianos y dólares no se suman. */
export async function totalesDeCartera(db: EjecutorSQL, hoy: Dia): Promise<TotalPorMoneda[]> {
  const filas = await db.getAllAsync<{
    moneda: string;
    prestamos: number;
    saldo_centavos: number | null;
    vencido_centavos: number | null;
  }>(
    `SELECT
       p.moneda AS moneda,
       COUNT(DISTINCT p.id) AS prestamos,
       SUM(${SALDO}) AS saldo_centavos,
       SUM(CASE WHEN o.vencimiento < ? THEN ${SALDO} ELSE 0 END) AS vencido_centavos
     FROM prestamos p
     JOIN obligaciones o ON o.prestamo_id = p.id AND ${COBRABLES}
     WHERE p.estado = 'activo'
     GROUP BY p.moneda
     ORDER BY p.moneda`,
    hoy,
  );

  return filas.map((fila) => {
    const moneda = fila.moneda as Moneda;
    return {
      moneda,
      prestamos: Number(fila.prestamos),
      saldo: dinero(fila.saldo_centavos ?? 0, moneda),
      vencido: dinero(fila.vencido_centavos ?? 0, moneda),
    };
  });
}

export type AsientoHistorial = {
  readonly id: number;
  readonly tipo: string;
  readonly fecha: Dia;
  readonly capital: Dinero;
  readonly interes: Dinero;
  readonly mora: Dinero;
  readonly detalle: string | null;
  readonly pagoId: number | null;
};

/**
 * El libro de un préstamo, de lo más nuevo a lo más viejo.
 *
 * Es lo que se le muestra al cliente cuando dice "yo te pagué": todo lo que pasó, incluidos
 * los asientos de reverso y las condonaciones, porque nada se borra.
 */
export async function historialDePrestamo(
  db: EjecutorSQL,
  prestamoId: number,
): Promise<AsientoHistorial[]> {
  const filas = await db.getAllAsync<{
    id: number;
    tipo: string;
    fecha: string;
    moneda: string | null;
    capital_centavos: number;
    interes_centavos: number;
    mora_centavos: number;
    detalle: string | null;
    pago_id: number | null;
  }>(
    `SELECT id, tipo, fecha, moneda, capital_centavos, interes_centavos, mora_centavos,
            detalle, pago_id
       FROM movimientos
      WHERE prestamo_id = ?
      ORDER BY fecha DESC, id DESC`,
    prestamoId,
  );

  return filas.map((fila) => {
    const moneda = (fila.moneda ?? 'BOB') as Moneda;
    return {
      id: fila.id,
      tipo: fila.tipo,
      fecha: fila.fecha as Dia,
      capital: dinero(fila.capital_centavos, moneda),
      interes: dinero(fila.interes_centavos, moneda),
      mora: dinero(fila.mora_centavos, moneda),
      detalle: fila.detalle,
      pagoId: fila.pago_id,
    };
  });
}

export type MovimientoCaja = {
  readonly id: number;
  readonly tipo: string;
  readonly fecha: Dia;
  readonly monto: Dinero;
  readonly detalle: string | null;
};

/** Los movimientos de caja, del más reciente al más viejo; `desde` salta los primeros. */
export async function ultimosMovimientosDeCaja(
  db: EjecutorSQL,
  limite = 40,
  desde = 0,
): Promise<MovimientoCaja[]> {
  const filas = await db.getAllAsync<{
    id: number;
    tipo: string;
    fecha: string;
    moneda: string;
    monto_centavos: number;
    detalle: string | null;
  }>(
    `SELECT id, tipo, fecha, moneda, monto_centavos, detalle
       FROM caja_movimientos
      ORDER BY fecha DESC, id DESC
      LIMIT ? OFFSET ?`,
    limite,
    desde,
  );

  return filas.map((fila) => ({
    id: fila.id,
    tipo: fila.tipo,
    fecha: fila.fecha as Dia,
    monto: dinero(fila.monto_centavos, fila.moneda as Moneda),
    detalle: fila.detalle,
  }));
}

export async function contarMovimientosDeCaja(db: EjecutorSQL): Promise<number> {
  const fila = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM caja_movimientos');
  return Number(fila?.n ?? 0);
}

export async function saldoDeCaja(db: EjecutorSQL): Promise<Dinero[]> {
  const filas = await db.getAllAsync<{ moneda: string; total_centavos: number | null }>(
    `SELECT moneda, SUM(monto_centavos) AS total_centavos
       FROM caja_movimientos
      GROUP BY moneda
      ORDER BY moneda`,
  );
  return filas.map((fila) => dinero(fila.total_centavos ?? 0, fila.moneda as Moneda));
}

// --- Comportamiento del cliente --------------------------------------------------------

export type ComportamientoCliente = {
  readonly moneda: Moneda;
  /** Lo que se le prestó en total, histórico. */
  readonly capitalPrestado: Dinero;
  /**
   * La plata que de verdad salió de tu mano: sin contar los préstamos que nacen de
   * refinanciar otro, que repiten la deuda vieja.
   */
  readonly capitalEntregado: Dinero;
  /** Interés efectivamente cobrado: la ganancia real sobre este cliente. */
  readonly interesCobrado: Dinero;
  readonly capitalRecuperado: Dinero;
  readonly moraCobrada: Dinero;
  readonly prestamos: number;
  readonly refinanciaciones: number;
  /**
   * El interés cobrado ya superó al capital prestado.
   *
   * Es la señal que un prestamista profesional mira: ese capital probablemente no vuelve, y
   * conviene reestructurar antes que seguir sumando interés sobre algo incobrable.
   */
  readonly interesSuperaCapital: boolean;
};

export async function comportamientoDeCliente(
  db: EjecutorSQL,
  clienteId: number,
): Promise<ComportamientoCliente[]> {
  const filas = await db.getAllAsync<{
    moneda: string;
    capital_prestado: number | null;
    capital_entregado: number | null;
    prestamos: number;
    refinanciaciones: number;
  }>(
    `SELECT moneda,
            SUM(capital_centavos) AS capital_prestado,
            SUM(CASE WHEN prestamo_origen_id IS NULL THEN capital_centavos ELSE 0 END)
              AS capital_entregado,
            COUNT(*) AS prestamos,
            SUM(CASE WHEN prestamo_origen_id IS NOT NULL THEN 1 ELSE 0 END) AS refinanciaciones
       FROM prestamos
      WHERE cliente_id = ?
      GROUP BY moneda`,
    clienteId,
  );

  // Los pagos revertidos no cuentan: un cobro anulado no es ganancia.
  const cobrado = await db.getAllAsync<{
    moneda: string;
    componente: string;
    total_centavos: number | null;
  }>(
    `SELECT p.moneda AS moneda, i.componente AS componente, SUM(i.monto_centavos) AS total_centavos
       FROM imputaciones i
       JOIN pagos pg     ON pg.id = i.pago_id
       JOIN prestamos p  ON p.id = pg.prestamo_id
      WHERE pg.cliente_id = ? AND pg.revertido_en IS NULL
      GROUP BY p.moneda, i.componente`,
    clienteId,
  );

  const porComponente = (moneda: Moneda, componente: string): Dinero => {
    const fila = cobrado.find((c) => c.moneda === moneda && c.componente === componente);
    return dinero(fila?.total_centavos ?? 0, moneda);
  };

  return filas.map((fila) => {
    const moneda = fila.moneda as Moneda;
    const capitalPrestado = dinero(fila.capital_prestado ?? 0, moneda);
    const interesCobrado = porComponente(moneda, 'interes');

    return {
      moneda,
      capitalPrestado,
      capitalEntregado: dinero(fila.capital_entregado ?? 0, moneda),
      interesCobrado,
      capitalRecuperado: porComponente(moneda, 'capital'),
      moraCobrada: porComponente(moneda, 'mora'),
      prestamos: Number(fila.prestamos),
      refinanciaciones: Number(fila.refinanciaciones),
      interesSuperaCapital:
        capitalPrestado.centavos > 0 && interesCobrado.centavos > capitalPrestado.centavos,
    };
  });
}

// --- Reporte de cobros -----------------------------------------------------------------

export type CobradoEnPeriodo = {
  readonly moneda: Moneda;
  /** Ganancia: lo cobrado como interés. */
  readonly interes: Dinero;
  /** Lo cobrado como penalización por atraso. */
  readonly penalizacion: Dinero;
  /** Recuperación de capital: plata que vuelve a tus manos, no es ganancia. */
  readonly capital: Dinero;
  readonly cantidadDePagos: number;
};

/**
 * Cuánto se cobró entre dos días (ambos incluidos), separado por componente.
 * Los pagos anulados no cuentan: un reverso deja de contarlos, no los resta.
 */
export async function cobradoEnPeriodo(
  db: EjecutorSQL,
  desde: Dia,
  hasta: Dia,
): Promise<CobradoEnPeriodo[]> {
  const filas = await db.getAllAsync<{
    moneda: string;
    interes: number | null;
    penalizacion: number | null;
    capital: number | null;
    pagos: number;
  }>(
    `SELECT
       p.moneda AS moneda,
       SUM(CASE WHEN i.componente = 'interes' THEN i.monto_centavos ELSE 0 END) AS interes,
       SUM(CASE WHEN i.componente = 'mora'    THEN i.monto_centavos ELSE 0 END) AS penalizacion,
       SUM(CASE WHEN i.componente = 'capital' THEN i.monto_centavos ELSE 0 END) AS capital,
       COUNT(DISTINCT p.id) AS pagos
     FROM pagos p
     JOIN imputaciones i ON i.pago_id = p.id
     WHERE p.revertido_en IS NULL AND p.fecha >= ? AND p.fecha <= ?
     GROUP BY p.moneda
     ORDER BY p.moneda`,
    desde,
    hasta,
  );

  return filas.map((fila) => {
    const moneda = fila.moneda as Moneda;
    return {
      moneda,
      interes: dinero(fila.interes ?? 0, moneda),
      penalizacion: dinero(fila.penalizacion ?? 0, moneda),
      capital: dinero(fila.capital ?? 0, moneda),
      cantidadDePagos: Number(fila.pagos),
    };
  });
}

// --- Cobros uno por uno ----------------------------------------------------------------

export type CobroDetallado = {
  readonly pagoId: number;
  readonly fecha: Dia;
  readonly prestamoId: number | null;
  readonly clienteId: number;
  readonly clienteNombre: string;
  /** Lo que entregó el cliente. */
  readonly monto: Dinero;
  readonly interes: Dinero;
  readonly penalizacion: Dinero;
  readonly capital: Dinero;
  readonly anulado: boolean;
};

type FiltroCobros =
  | { readonly prestamoId: number }
  | { readonly clienteId: number }
  | { readonly desde: Dia; readonly hasta: Dia; readonly sinAnulados: true };

/**
 * Cada cobro con su reparto entre interés, penalización y capital: lo que responde
 * "¿cuánto gané en este pago?". Del más reciente al más viejo.
 */
export async function cobrosDetallados(
  db: EjecutorSQL,
  filtro: FiltroCobros,
): Promise<CobroDetallado[]> {
  const donde =
    'prestamoId' in filtro
      ? { sql: 'p.prestamo_id = ?', params: [filtro.prestamoId] as (string | number)[] }
      : 'clienteId' in filtro
        ? { sql: 'p.cliente_id = ?', params: [filtro.clienteId] as (string | number)[] }
        : {
          sql: 'p.revertido_en IS NULL AND p.fecha >= ? AND p.fecha <= ?',
          params: [filtro.desde, filtro.hasta] as (string | number)[],
        };

  const filas = await db.getAllAsync<{
    id: number;
    fecha: string;
    prestamo_id: number | null;
    cliente_id: number;
    cliente: string;
    moneda: string;
    monto_centavos: number;
    interes: number;
    penalizacion: number;
    capital: number;
    revertido_en: string | null;
  }>(
    `SELECT
       p.id AS id, p.fecha AS fecha, p.prestamo_id AS prestamo_id, p.cliente_id AS cliente_id, c.nombre AS cliente,
       p.moneda AS moneda, p.monto_centavos AS monto_centavos, p.revertido_en AS revertido_en,
       COALESCE(SUM(CASE WHEN i.componente = 'interes' THEN i.monto_centavos END), 0) AS interes,
       COALESCE(SUM(CASE WHEN i.componente = 'mora'    THEN i.monto_centavos END), 0) AS penalizacion,
       COALESCE(SUM(CASE WHEN i.componente = 'capital' THEN i.monto_centavos END), 0) AS capital
     FROM pagos p
     JOIN clientes c ON c.id = p.cliente_id
     LEFT JOIN imputaciones i ON i.pago_id = p.id
     WHERE ${donde.sql}
     GROUP BY p.id
     ORDER BY p.fecha DESC, p.id DESC`,
    ...donde.params,
  );

  return filas.map((fila) => {
    const moneda = fila.moneda as Moneda;
    return {
      pagoId: fila.id,
      fecha: fila.fecha as Dia,
      prestamoId: fila.prestamo_id,
      clienteId: fila.cliente_id,
      clienteNombre: fila.cliente,
      monto: dinero(fila.monto_centavos, moneda),
      interes: dinero(fila.interes, moneda),
      penalizacion: dinero(fila.penalizacion, moneda),
      capital: dinero(fila.capital, moneda),
      anulado: fila.revertido_en !== null,
    };
  });
}

// --- Pérdidas --------------------------------------------------------------------------

export type PerdidaPorMoneda = {
  readonly moneda: Moneda;
  /** Capital que no volvió: lo pendiente de los préstamos dados por perdidos. */
  readonly perdido: Dinero;
  readonly prestamos: number;
};

/**
 * Lo perdido, separado por moneda. Se deriva del capital pendiente de los préstamos
 * `incobrable`: si uno se reactiva, deja de contar solo. Con `clienteId`, solo de ese cliente.
 */
export async function perdidas(db: EjecutorSQL, clienteId?: number): Promise<PerdidaPorMoneda[]> {
  const filas = await db.getAllAsync<{
    moneda: string;
    perdido_centavos: number | null;
    prestamos: number;
  }>(
    `SELECT p.moneda AS moneda,
            SUM(o.capital_centavos - o.pagado_capital_centavos) AS perdido_centavos,
            COUNT(DISTINCT p.id) AS prestamos
       FROM prestamos p
       JOIN obligaciones o ON o.prestamo_id = p.id AND ${COBRABLES}
      WHERE p.estado = 'incobrable' ${clienteId === undefined ? '' : 'AND p.cliente_id = ?'}
      GROUP BY p.moneda
      ORDER BY p.moneda`,
    ...(clienteId === undefined ? [] : [clienteId]),
  );

  return filas.map((fila) => {
    const moneda = fila.moneda as Moneda;
    return {
      moneda,
      perdido: dinero(fila.perdido_centavos ?? 0, moneda),
      prestamos: Number(fila.prestamos),
    };
  });
}

// --- Actividad reciente ----------------------------------------------------------------

export type Actividad = {
  readonly clave: string;
  readonly tipo: 'cobro' | 'prestamo';
  readonly fecha: Dia;
  readonly clienteNombre: string;
  /** Siempre positivo: el sentido lo da el tipo (un cobro entra, un préstamo sale). */
  readonly monto: Dinero;
};

/**
 * Lo último que pasó: cobros (sin los anulados) y préstamos entregados (sin los que nacen de
 * refinanciar, que no sacan plata nueva). Lo más reciente primero.
 */
export async function actividadReciente(db: EjecutorSQL, limite = 6): Promise<Actividad[]> {
  const filas = await db.getAllAsync<{
    tipo: 'cobro' | 'prestamo';
    id: number;
    fecha: string;
    monto_centavos: number;
    moneda: string;
    cliente: string;
  }>(
    `SELECT * FROM (
       SELECT 'cobro' AS tipo, pg.id AS id, pg.fecha AS fecha, pg.monto_centavos AS monto_centavos,
              pg.moneda AS moneda, c.nombre AS cliente, pg.creado_en AS creado_en
         FROM pagos pg JOIN clientes c ON c.id = pg.cliente_id
        WHERE pg.revertido_en IS NULL
       UNION ALL
       SELECT 'prestamo', p.id, p.fecha_desembolso, p.capital_centavos, p.moneda, c.nombre, p.creado_en
         FROM prestamos p JOIN clientes c ON c.id = p.cliente_id
        WHERE p.prestamo_origen_id IS NULL
     )
     ORDER BY fecha DESC, creado_en DESC
     LIMIT ?`,
    limite,
  );

  return filas.map((fila) => ({
    clave: `${fila.tipo}-${fila.id}`,
    tipo: fila.tipo,
    fecha: fila.fecha as Dia,
    clienteNombre: fila.cliente,
    monto: dinero(fila.monto_centavos, fila.moneda as Moneda),
  }));
}

// --- Deuda por cliente -----------------------------------------------------------------

export type DeudaDeCliente = {
  /** Una entrada por moneda: bolivianos y dólares no se suman. */
  readonly saldos: readonly Dinero[];
  readonly atrasado: boolean;
};

/** Cuánto debe cada cliente en sus préstamos activos, para la lista de clientes. */
export async function deudaPorCliente(
  db: EjecutorSQL,
  hoy: Dia,
): Promise<Map<number, DeudaDeCliente>> {
  const filas = await db.getAllAsync<{
    cliente_id: number;
    moneda: string;
    saldo_centavos: number | null;
    vencido_centavos: number | null;
  }>(
    `SELECT p.cliente_id AS cliente_id,
            p.moneda AS moneda,
            SUM(${SALDO}) AS saldo_centavos,
            SUM(CASE WHEN o.vencimiento < ? THEN ${SALDO} ELSE 0 END) AS vencido_centavos
       FROM prestamos p
       JOIN obligaciones o ON o.prestamo_id = p.id AND ${COBRABLES}
      WHERE p.estado = 'activo'
      GROUP BY p.cliente_id, p.moneda
      ORDER BY p.moneda`,
    hoy,
  );

  const porCliente = new Map<number, { saldos: Dinero[]; atrasado: boolean }>();
  for (const fila of filas) {
    if ((fila.saldo_centavos ?? 0) <= 0) continue;
    const actual = porCliente.get(fila.cliente_id) ?? { saldos: [], atrasado: false };
    actual.saldos.push(dinero(fila.saldo_centavos ?? 0, fila.moneda as Moneda));
    actual.atrasado = actual.atrasado || (fila.vencido_centavos ?? 0) > 0;
    porCliente.set(fila.cliente_id, actual);
  }
  return porCliente;
}

// --- Caja ------------------------------------------------------------------------------

/**
 * Si ya se dijo con cuánta plata se empezó: hay algún aporte o un arqueo. Sin eso, la caja
 * arranca en cero y el primer préstamo la deja en negativo.
 */
export async function cajaIniciada(db: EjecutorSQL): Promise<boolean> {
  const fila = await db.getFirstAsync<{ hay: number }>(
    `SELECT EXISTS (
       SELECT 1 FROM caja_movimientos WHERE tipo IN ('aporte', 'ajuste')
     ) AS hay`,
  );
  return Number(fila?.hay ?? 0) === 1;
}
