import { AuraError, type AuraErrorType } from './errors.js'
import { Vouchers } from './resources/vouchers.js'
import { Clients } from './resources/clients.js'
import { Webhooks } from './resources/webhooks.js'

export interface AuraOptions {
  /**
   * API Key de Aura: `aura_test_...`, `aura_live_...` o legacy `aura_<hex>_...`.
   * El modo (test/live) se deriva del prefijo de la key — no se envía por request.
   */
  apiKey: string
  /**
   * Base URL del API, incluyendo el prefijo de versión.
   * Default (Cloud, tras proxy): `https://aura.nexo.com.do/api/v1`.
   * Self-hosted directo al backend: `http://localhost:3001/v1`.
   */
  baseUrl?: string
  /** Timeout por request en ms. Default 30000. */
  timeoutMs?: number
  /** Reintentos ante errores transitorios (429/5xx/red). Default 2. */
  maxRetries?: number
  /** `fetch` personalizado (tests, proxies). Default: global fetch. */
  fetch?: typeof fetch
}

export interface RequestOptions {
  /** Header `Idempotency-Key` (solo emisión). 8-100 chars ASCII seguros. */
  idempotencyKey?: string
  /** AbortSignal para cancelar el request. */
  signal?: AbortSignal
}

const DEFAULT_BASE_URL = 'https://aura.nexo.com.do/api/v1'

export class Aura {
  readonly vouchers: Vouchers
  /** Gestión de clientes (emisores), certificado y secuencias NCF. */
  readonly clients: Clients
  /** Gestión de suscripciones a webhooks (+ `verifySignature`). */
  readonly webhooks: Webhooks

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch

  constructor(options: AuraOptions | string) {
    const opts = typeof options === 'string' ? { apiKey: options } : options
    if (!opts.apiKey) throw new Error('Aura: apiKey es requerido')

    this.apiKey = opts.apiKey
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.maxRetries = opts.maxRetries ?? 2
    this.fetchImpl = opts.fetch ?? globalThis.fetch
    if (!this.fetchImpl) {
      throw new Error('Aura: no hay `fetch` disponible. Usa Node >= 18 o pásalo en options.fetch')
    }

    this.vouchers = new Vouchers(this)
    this.clients = new Clients(this)
    this.webhooks = new Webhooks(this)
  }

  /** `test` | `live` | `legacy`, derivado del prefijo de la API Key. */
  get mode(): 'test' | 'live' | 'legacy' {
    if (this.apiKey.startsWith('aura_test_')) return 'test'
    if (this.apiKey.startsWith('aura_live_')) return 'live'
    return 'legacy'
  }

  /** @internal Ejecuta un request HTTP con reintentos y mapeo de errores. */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      'User-Agent': 'aura-sdk-node'
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

    let lastError: AuraError | undefined
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      const onAbort = () => controller.abort()
      options.signal?.addEventListener('abort', onAbort)

      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        })

        if (res.ok) {
          if (res.status === 204) return undefined as T
          return (await res.json()) as T
        }

        const err = await this.toError(res)
        // No reintentar mutaciones no-idempotentes sin Idempotency-Key.
        const safe = method === 'GET' || !!options.idempotencyKey
        if (err.isRetryable && safe && attempt < this.maxRetries) {
          lastError = err
          await this.backoff(attempt, res.headers.get('retry-after'))
          continue
        }
        throw err
      } catch (e) {
        if (e instanceof AuraError) throw e
        // Error de red/timeout.
        const netErr = new AuraError({
          type: 'NETWORK',
          title: 'Error de red',
          message: e instanceof Error ? e.message : 'Fallo de conexión con Aura',
          status: 0
        })
        const safe = method === 'GET' || !!options.idempotencyKey
        if (safe && attempt < this.maxRetries) {
          lastError = netErr
          await this.backoff(attempt, null)
          continue
        }
        throw netErr
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
    }
    throw lastError ?? new AuraError({ type: 'INTERNAL', title: 'Error', message: 'sin respuesta', status: 0 })
  }

  private async toError(res: Response): Promise<AuraError> {
    let payload: { error?: { type?: string; title?: string; message?: string; details?: unknown }; requestId?: string } = {}
    try {
      payload = (await res.json()) as typeof payload
    } catch {
      /* respuesta sin JSON */
    }
    const e = payload.error ?? {}
    return new AuraError({
      type: (e.type as AuraErrorType) ?? this.typeFromStatus(res.status),
      title: e.title ?? res.statusText ?? 'Error',
      message: e.message ?? `Aura respondió ${res.status}`,
      status: res.status,
      details: e.details,
      requestId: payload.requestId
    })
  }

  private typeFromStatus(status: number): AuraErrorType {
    const map: Record<number, AuraErrorType> = {
      400: 'VALIDATION',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'DGII_REJECTED',
      429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE'
    }
    return map[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION')
  }

  private backoff(attempt: number, retryAfter: string | null): Promise<void> {
    let delay = Math.min(500 * 2 ** attempt, 8_000)
    const ra = retryAfter ? Number(retryAfter) : NaN
    if (Number.isFinite(ra)) delay = ra * 1000
    return new Promise((r) => setTimeout(r, delay))
  }
}
