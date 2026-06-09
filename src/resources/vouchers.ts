import type { Aura, RequestOptions } from '../client.js'
import { AuraError } from '../errors.js'
import type {
  IssueVoucherParams,
  IssueVoucherResult,
  Voucher,
  ListVouchersParams,
  ListVouchersResult,
  VoidVoucherParams,
  CommercialApprovalParams,
  CommercialApprovalResult,
  ReceiveVoucherParams,
  ReceiveVoucherResult
} from '../types.js'

/** Estados terminales: ya no cambian con más polling. */
const TERMINAL_STATUSES = new Set(['ACCEPTED', 'CONDITIONAL', 'REJECTED', 'NOT_FOUND', 'VOIDED'])

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface IssueOptions {
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface IssueAndWaitOptions extends IssueOptions {
  /** Tiempo máximo de polling tras emitir, en ms. Default 8000. */
  timeoutMs?: number
  /** Intervalo entre consultas, en ms. Default 350. */
  intervalMs?: number
}

/** Operaciones sobre comprobantes fiscales electrónicos (e-CF). */
export class Vouchers {
  constructor(private readonly client: Aura) {}

  /**
   * Emite un e-CF. Devuelve 202 — el voucher se firma y envía a DGII de forma
   * asíncrona. Sondea con `retrieve()` o suscríbete a webhooks para el estado final.
   *
   * Pasa `idempotencyKey` para que un reintento por timeout/red no consuma un
   * NCF nuevo ni cree un duplicado.
   */
  issue(params: IssueVoucherParams, options?: IssueOptions): Promise<IssueVoucherResult> {
    return this.client.request<IssueVoucherResult>('POST', '/vouchers', params, options)
  }

  /**
   * Emite y **espera la firma**: tras emitir, hace polling hasta obtener
   * `qrUrl` + `securityCode` (lo necesario para imprimir la Representación
   * Impresa) o hasta `timeoutMs`. Devuelve el `Voucher` consultado.
   *
   * - Lanza `AuraError` (type `DGII_REJECTED`) si DGII rechaza el comprobante.
   * - Si se agota el tiempo sin firma, devuelve el último estado conocido (sin
   *   `qrUrl`); el webhook `voucher.signed` lo completará después.
   *
   * Replica el comportamiento síncrono del gateway de Backend/API. Para el
   * camino puramente asíncrono (responder rápido y depender de webhooks), usa `issue`.
   */
  async issueAndWait(params: IssueVoucherParams, options: IssueAndWaitOptions = {}): Promise<Voucher> {
    const { timeoutMs = 8000, intervalMs = 350, ...issueOpts } = options
    const created = await this.issue(params, issueOpts)

    const deadline = Date.now() + timeoutMs
    let last: Voucher = { ...(created as unknown as Voucher) }
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new AuraError({ type: 'NETWORK', title: 'Cancelado', message: 'Operación cancelada', status: 0 })
      await sleep(intervalMs)
      last = await this.retrieve(created.id, { signal: options.signal })
      if (last.qrUrl && last.securityCode) return last
      if (last.status === 'REJECTED') {
        const detail = Array.isArray(last.dgiiMessages) && last.dgiiMessages.length
          ? last.dgiiMessages.map((m) => (typeof m === 'object' && m ? JSON.stringify(m) : String(m))).join(' · ')
          : 'Sin detalle'
        throw new AuraError({
          type: 'DGII_REJECTED',
          title: 'e-CF rechazado por DGII',
          message: detail,
          status: 422,
          details: last.dgiiMessages
        })
      }
      if (TERMINAL_STATUSES.has(last.status)) return last
    }
    return last
  }

  /** Obtiene un voucher por id (incluye `items`, `qrUrl`, `securityCode`, estado DGII). */
  retrieve(id: string, options?: RequestOptions): Promise<Voucher> {
    return this.client.request<Voucher>('GET', `/vouchers/${encodeURIComponent(id)}`, undefined, options)
  }

  /** Lista vouchers con filtros y paginación. */
  list(params: ListVouchersParams = {}, options?: RequestOptions): Promise<ListVouchersResult> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      qs.set(k, String(v))
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return this.client.request<ListVouchersResult>('GET', `/vouchers${suffix}`, undefined, options)
  }

  /** Fuerza una re-consulta del estado en DGII (202). */
  refresh(id: string, options?: RequestOptions): Promise<IssueVoucherResult> {
    return this.client.request<IssueVoucherResult>('POST', `/vouchers/${encodeURIComponent(id)}/refresh`, undefined, options)
  }

  /** Anula un voucher emitido vía ANECF (202). `modificationCode` es obligatorio. */
  void(id: string, params: VoidVoucherParams, options?: RequestOptions): Promise<IssueVoucherResult> {
    return this.client.request<IssueVoucherResult>('POST', `/vouchers/${encodeURIComponent(id)}/void`, params, options)
  }

  /** Envía una aprobación comercial (ACECF) sobre un e-CF recibido (202). */
  commercialApproval(
    id: string,
    params: CommercialApprovalParams,
    options?: RequestOptions
  ): Promise<CommercialApprovalResult> {
    return this.client.request<CommercialApprovalResult>(
      'POST',
      `/vouchers/${encodeURIComponent(id)}/commercial-approval`,
      params,
      options
    )
  }

  /**
   * Registra un e-CF **recibido** de un proveedor (Nexo como comprador). Reenvía
   * el XML firmado al receptor; Aura lo guarda con `origin=RECEIVED` y dispara
   * el webhook `voucher.received` (201).
   */
  receive(params: ReceiveVoucherParams, options?: RequestOptions): Promise<ReceiveVoucherResult> {
    return this.client.request<ReceiveVoucherResult>('POST', '/vouchers/receive', params, options)
  }
}
