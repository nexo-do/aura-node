import type { Aura, RequestOptions } from '../client.js'
import type {
  IssueVoucherParams,
  IssueVoucherResult,
  Voucher,
  ListVouchersParams,
  ListVouchersResult,
  VoidVoucherParams,
  CommercialApprovalParams
} from '../types.js'

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
  issue(params: IssueVoucherParams, options?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<IssueVoucherResult> {
    return this.client.request<IssueVoucherResult>('POST', '/vouchers', params, options)
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

  /** Anula un voucker emitido vía ANECF (202). `modificationCode` es obligatorio. */
  void(id: string, params: VoidVoucherParams, options?: RequestOptions): Promise<IssueVoucherResult> {
    return this.client.request<IssueVoucherResult>('POST', `/vouchers/${encodeURIComponent(id)}/void`, params, options)
  }

  /** Envía una aprobación comercial (ACECF) sobre un e-CF recibido (202). */
  commercialApproval(id: string, params: CommercialApprovalParams, options?: RequestOptions): Promise<IssueVoucherResult> {
    return this.client.request<IssueVoucherResult>(
      'POST',
      `/vouchers/${encodeURIComponent(id)}/commercial-approval`,
      params,
      options
    )
  }
}
