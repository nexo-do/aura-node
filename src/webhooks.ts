import crypto from 'node:crypto'

export interface WebhookHeaders {
  /** `X-ECF-Signature` — `sha256=<hex>`. */
  signature?: string | null
  /** `X-ECF-Timestamp` — epoch en ms. */
  timestamp?: string | number | null
  /** `X-ECF-Delivery` — id único del intento. */
  delivery?: string | null
}

export interface VerifyOptions {
  /** Tolerancia anti-replay en segundos. Default 300 (±5 min). */
  toleranceSeconds?: number
}

/**
 * Verifica la firma HMAC-SHA256 de un webhook de Aura.
 *
 * La cadena firmada es `${timestamp}.${deliveryId}.${rawBody}`. `rawBody` debe
 * ser el cuerpo **crudo** (string o Buffer) tal como llegó — no el objeto
 * parseado y re-serializado.
 *
 * @throws Error si la firma no coincide o el timestamp está fuera de tolerancia.
 */
export function verifyWebhook(
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string,
  options: VerifyOptions = {}
): void {
  const tolerance = options.toleranceSeconds ?? 300
  const signature = headers.signature ?? ''
  const timestamp = headers.timestamp ?? ''
  const delivery = headers.delivery ?? ''

  if (!signature) throw new Error('Webhook sin header X-ECF-Signature')
  if (!timestamp) throw new Error('Webhook sin header X-ECF-Timestamp')

  const tsMs = Number(timestamp)
  if (!Number.isFinite(tsMs)) throw new Error('X-ECF-Timestamp inválido')
  const ageSeconds = Math.abs(Date.now() - tsMs) / 1000
  if (ageSeconds > tolerance) {
    throw new Error(`Webhook fuera de tolerancia anti-replay (${Math.round(ageSeconds)}s > ${tolerance}s)`)
  }

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  const signedPayload = `${timestamp}.${delivery}.${body}`
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')

  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Firma de webhook inválida')
  }
}

/** Variante booleana de `verifyWebhook` (no lanza). */
export function isValidWebhook(
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string,
  options?: VerifyOptions
): boolean {
  try {
    verifyWebhook(rawBody, headers, secret, options)
    return true
  } catch {
    return false
  }
}
