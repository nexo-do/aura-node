/**
 * Tipos del API de Aura — núcleo de emisión de e-CF (DGII RD).
 * Reflejan los schemas Zod del backend (`modules/vouchers/schemas.ts`).
 */

/** Tipos de e-CF electrónicos soportados (E31..E47). */
export type EcfTypeId =
  | '31' // Factura de Crédito Fiscal
  | '32' // Factura de Consumo
  | '33' // Nota de Débito
  | '34' // Nota de Crédito
  | '41' // Compras
  | '43' // Gastos Menores
  | '44' // Regímenes Especiales
  | '45' // Gubernamental
  | '46' // Exportaciones
  | '47' // Pagos al Exterior

/** Estado del lifecycle del voucher (interno + DGII). */
export type VoucherStatus =
  | 'PENDING'
  | 'SIGNED'
  | 'IN_PROCESS'
  | 'ACCEPTED'
  | 'CONDITIONAL'
  | 'REJECTED'
  | 'NOT_FOUND'
  | 'WAITING_DEFERRED'
  | 'VOIDED'

/** 1 = Contado, 2 = Crédito, 3 = Gratuito. */
export type PaymentType = 1 | 2 | 3

/** 1=Bien, 2=Servicio (IndicadorBienoServicio DGII). */
export type GoodOrService = 1 | 2

/** TipoIngresos DGII (Tabla X). */
export type IncomeType = '01' | '02' | '03' | '04' | '05' | '06'

/** Código de modificación DGII (Anexo A, Tabla VI) — solo NC/ND. */
export type ModificationCode = 1 | 2 | 3 | 4 | 5

/** FormaPagoDetalle DGII (Tabla VII). */
export type PaymentMethod = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** Comprador. RNC, foreignId o legalName son alternativos (al menos uno). */
export interface Counterpart {
  /** RNC/Cédula — 9 u 11 dígitos. */
  rnc?: string
  /** IdentificadorExtranjero (E46/E47 cuando no hay RNC). */
  foreignId?: string
  legalName?: string
  address?: string
  /** Municipio (obligatorio en RI para E31/E33/E41/E45). */
  municipality?: string
  /** Provincia (obligatorio en RI para E31/E33/E41/E45). */
  province?: string
  /** País destino ISO-3166 alpha-3 (E46/E47). */
  countryCode?: string
  email?: string
}

/** Retención por línea (E41/E45/E47 con servicios). */
export interface LineRetention {
  /** % del ITBIS retenido: 0, 30, 75, 100. */
  itbisRetentionRate?: number
  /** % sobre el monto del ítem: 0, 2, 10, 27. */
  isrRetentionRate?: number
}

export interface EcfItem {
  description: string
  unitCode?: string
  /** Cantidad — máx 3 decimales (DGII). */
  quantity: number
  /** Precio unitario — máx 4 decimales (DGII). */
  unitPrice: number
  /** Descuento por línea. Default 0. */
  discountAmount?: number
  /** Tasa ITBIS: 0, 16 o 18. Default 18. */
  itbisRate?: 0 | 16 | 18
  /** Con itbisRate=0: true = Gravado 0% (exportación), false/omitido = Exento. */
  isExport?: boolean
  /** Código ISC del catálogo Tabla I DGII (ej. '001'). */
  iscCode?: string
  /** CantidadReferencia (ISC 006-039). */
  referenceQty?: number
  /** GradosAlcohol (0-100) para alcoholes con ISC específico. */
  alcoholDegrees?: number
  /** Subcantidades (alcoholes/cigarrillos). */
  subQuantities?: Array<{ code: string; qty: number }>
  /** PrecioUnitarioReferencia (ad valorem, ISC 023-039) — máx 4 decimales. */
  unitPriceRef?: number
  /** 1=Bien, 2=Servicio. Default 1. */
  goodOrService?: GoodOrService
  retention?: LineRetention
}

export interface AdditionalInfo {
  transport?: {
    carrier?: string
    licensePlate?: string
    documentNumber?: string
    deliveryAddress?: string
  }
  notes?: string
  /** Subtotales informativos arbitrarios (categoría → monto). */
  subtotals?: Record<string, number>
}

/** Payload de `POST /v1/vouchers`. */
export interface IssueVoucherParams {
  clientId: string
  typeId: EcfTypeId
  counterpart?: Counterpart
  /** 1=Contado, 2=Crédito, 3=Gratuito. Default 1. */
  paymentType?: PaymentType
  /** Desglose por medio de pago (máx 8). La suma debe igualar el total. */
  paymentDetail?: Array<{ method: PaymentMethod; amount: number }>
  /** FechaLimitePago — requerido si paymentType=2. ISO yyyy-mm-dd. */
  paymentDueDate?: string
  /** TipoIngresos DGII. Default '01'. */
  incomeType?: IncomeType
  /** 0 = montos NO incluyen ITBIS, 1 = sí. Default 0. */
  taxIncluded?: 0 | 1
  /** Indicador Norma 10-07 (ISC en base ITBIS). Default 0. */
  indicatorNorma1007?: 0 | 1
  items: EcfItem[]
  globalDiscount?: number
  globalSurcharge?: number
  /** ISO-4217. Default 'DOP'. */
  currency?: string
  /** Requerido si currency != DOP. */
  exchangeRate?: number
  /** e-NCF original (13 chars) — solo NC/ND. */
  referenceNcf?: string
  /** Fecha del e-CF referenciado — solo NC/ND. */
  referenceDate?: string
  /** Código de modificación DGII — solo NC/ND. */
  modificationCode?: ModificationCode
  modificationReason?: string
  /** IndicadorNotaCredito — requerido en E34 (>30 días). 0|1. */
  noteAfter30Days?: 0 | 1
  referenceVoucherId?: string
  additionalInfo?: AdditionalInfo
  /** Páginas físicas de la RI. Default 1. */
  pageCount?: number
  /** Distribución de líneas por página (longitud == pageCount, suma == items.length). */
  linesPerPage?: number[]
}

/** Respuesta 202 de `POST /v1/vouchers`. */
export interface IssueVoucherResult {
  id: string
  ncf: string
  status: VoucherStatus
  /** true cuando el job de envío a DGII fue encolado. */
  queued?: boolean
  message?: string
  /** Presentes en modo contingencia. */
  contingency?: boolean
  signed?: boolean
  printable?: boolean
  signError?: string
  /** true si la respuesta vino de una key de idempotencia ya usada. */
  idempotent?: boolean
}

/** Ítem persistido del voucher (en `GET /v1/vouchers/:id`). */
export interface VoucherItem {
  id: string
  voucherId: string
  description: string
  quantity: string
  unitPrice: string
  [key: string]: unknown
}

/** Voucher completo (`GET /v1/vouchers/:id`). Montos vienen como string (numeric). */
export interface Voucher {
  id: string
  projectId: string
  clientId: string
  origin: 'ISSUED' | 'RECEIVED'
  env: string
  typeId: EcfTypeId
  sequenceNumber: number
  ncf: string
  issuerRnc: string
  issuerLegalName: string
  counterpartRnc: string | null
  counterpartForeignId: string | null
  counterpartName: string | null
  counterpartCountryCode: string | null
  totalAmount: string
  taxedAmount: string
  exemptAmount: string
  itbisAmount: string
  iscAmount: string
  currency: string
  status: VoucherStatus
  dgiiStatusCode: number | null
  dgiiMessages: unknown[] | null
  securityCode: string | null
  qrUrl: string | null
  trackId: string | null
  receiptAck: string
  commercialApproval: string
  issuedAt: string
  signedAt: string | null
  acceptedAt: string | null
  voidedAt: string | null
  createdAt: string
  updatedAt: string
  items?: VoucherItem[]
  [key: string]: unknown
}

export interface ListVouchersParams {
  clientId?: string
  status?: string
  origin?: 'ISSUED' | 'RECEIVED'
  typeId?: EcfTypeId
  /** ISO date — filtra issuedAt >= from. */
  from?: string
  /** ISO date — filtra issuedAt <= to. */
  to?: string
  archived?: boolean
  /** 1..200. Default 50. */
  limit?: number
  offset?: number
}

export interface ListVouchersResult {
  items: Voucher[]
  total: number
  /** true si `total` está topado (hay más de los contados). */
  totalCapped: boolean
  limit: number
  offset: number
}

export interface VoidVoucherParams {
  /** Mín 10, máx 500 caracteres. */
  reason: string
  /** Código DGII Tabla VI (obligatorio). */
  modificationCode: ModificationCode
}

export interface CommercialApprovalParams {
  status: 'ACCEPTED' | 'REJECTED'
  reason?: string
}
