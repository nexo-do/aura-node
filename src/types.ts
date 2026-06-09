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

/** Resultado 202 de aprobación comercial (`commercial-approval`). */
export interface CommercialApprovalResult {
  id: string
  queued: boolean
  [key: string]: unknown
}

/** Payload de `POST /v1/vouchers/receive`. */
export interface ReceiveVoucherParams {
  clientId: string
  /** XML firmado recibido del emisor (texto crudo o base64). */
  signedXml: string
}

export interface ReceiveVoucherResult {
  voucherId: string
  [key: string]: unknown
}

// ===== Clients (emisores RNC) ===============================================

/** Ambiente DGII. `TesteCF`/`CerteCF` = pruebas/certificación; `eCF` = producción. */
export type DgiiEnv = 'TesteCF' | 'CerteCF' | 'eCF'

/** Payload de `POST /v1/clients`. */
export interface CreateClientParams {
  /** RNC del emisor — 9 u 11 dígitos. */
  rnc: string
  legalName: string
  tradeName?: string
  address: string
  municipality?: string
  province?: string
  /** Hasta 3 teléfonos. */
  phones?: string[]
  email?: string
  economicActivity?: string
  /** Ambiente activo del cliente. Default `TesteCF`. */
  activeEnv?: DgiiEnv
  /** URL de recepción de e-CF (P2P). */
  receptionUrl?: string
  commercialApprovalUrl?: string
  authenticationUrl?: string
  settings?: Record<string, unknown>
}

export type UpdateClientParams = Partial<CreateClientParams>

/** Cliente (emisor) persistido. */
export interface Client {
  id: string
  rnc: string
  legalName: string
  tradeName?: string | null
  activeEnv?: DgiiEnv
  /** Algunos endpoints exponen el ambiente como `env`. */
  env?: DgiiEnv
  isActive?: boolean
  contingencyMode?: boolean
  contingencyAuthorizedUntil?: string | null
  certificateExpiresAt?: string | null
  [key: string]: unknown
}

/** Payload de subida de certificado P12 (`POST /v1/clients/:id/certificate`). */
export interface UploadCertificateParams {
  /** PKCS#12 en base64. */
  p12Base64: string
  password: string
}

export interface UploadCertificateResult {
  ok: boolean
  /** Fecha de expiración del certificado (ISO) o null si no se pudo parsear. */
  expiresAt: string | null
  [key: string]: unknown
}

/** Secuencia/rango NCF de un cliente. */
export interface Sequence {
  id: string
  typeId: EcfTypeId
  /** Próximo número a emitir dentro del rango. */
  currentNumber: number
  startOn: number
  stopOn: number
  /** Vencimiento del rango (ISO yyyy-mm-dd) o null (E32/E34 no vencen). */
  expireAt: string | null
  env: DgiiEnv
  [key: string]: unknown
}

/** Payload de `POST /v1/clients/:id/sequences`. */
export interface CreateSequenceParams {
  typeId: EcfTypeId
  env: DgiiEnv
  startOn: number
  stopOn: number
  /** yyyy-mm-dd. Omitir para rangos sin vencimiento (E32/E34). */
  expireAt?: string
}

/**
 * Payload de `PATCH /v1/clients/:id/sequences/:seqId`. `typeId`/`env` son
 * inmutables. `expireAt: null` **borra** el vencimiento; `undefined` lo deja igual.
 */
export interface UpdateSequenceParams {
  startOn?: number
  stopOn?: number
  expireAt?: string | null
}

export interface DeleteResult {
  ok: boolean
  [key: string]: unknown
}

// ===== Webhooks (gestión de suscripciones) ==================================

/** Catálogo canónico de eventos webhook de Aura. */
export const WEBHOOK_EVENTS = [
  'voucher.signed',
  'voucher.in_process',
  'voucher.accepted',
  'voucher.conditional',
  'voucher.rejected',
  'voucher.not_found',
  'voucher.voided',
  'voucher.autovoided',
  'voucher.received',
  'voucher.commercial_approval',
  'certification.stage_changed',
  'certification.artifact_uploaded',
  'certificate.expiring',
  'sequence.low',
  'sequence.expiring',
  'billing.payment_failed',
  'billing.free_quota_warning',
  'billing.free_quota_reached'
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

/** Payload de `POST /v1/webhooks`. */
export interface CreateWebhookParams {
  name: string
  url: string
  events: WebhookEvent[]
  /** Limita el webhook a un cliente específico. */
  clientId?: string
  /** `live` = solo eventos eCF; `test` = solo TesteCF/CerteCF; omitido = todos. */
  mode?: 'test' | 'live'
  /** Secret custom (mín 16 chars). Omitir para que el servidor genere uno seguro. */
  secret?: string
}

export interface UpdateWebhookParams extends Partial<CreateWebhookParams> {
  isActive?: boolean
}

/** Webhook (proyección segura — nunca expone el secret). */
export interface Webhook {
  id: string
  name: string
  url: string
  events: WebhookEvent[]
  clientId?: string | null
  mode?: 'test' | 'live' | null
  isActive: boolean
  /** true si el webhook tiene secret configurado. El valor nunca se expone. */
  hasSecret: boolean
  createdAt?: string
  [key: string]: unknown
}

/** Respuesta de creación: incluye el `secret` en PLANO, **una sola vez**. */
export interface CreateWebhookResult extends Webhook {
  secret: string
}

/** Respuesta de rotación de secret. */
export interface RotateSecretResult {
  id: string
  secret: string
}

/** Intento de entrega de un webhook. */
export interface WebhookDelivery {
  id: string
  event: string
  status: string
  [key: string]: unknown
}
