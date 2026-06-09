import type { Aura, RequestOptions } from '../client.js'
import type {
  Webhook,
  CreateWebhookParams,
  UpdateWebhookParams,
  CreateWebhookResult,
  RotateSecretResult,
  WebhookDelivery
} from '../types.js'
import { verifyWebhook, type WebhookHeaders, type VerifyOptions } from '../webhooks.js'

/**
 * Gestión de suscripciones a webhooks (alta/baja/listado/rotación de secret).
 *
 * Para **verificar la firma** de un webhook entrante usa `verifyWebhook`
 * (export top-level) o el atajo `aura.webhooks.verifySignature(...)`.
 */
export class Webhooks {
  constructor(private readonly client: Aura) {}

  /** Lista los webhooks del project (nunca expone el secret, solo `hasSecret`). */
  list(options?: RequestOptions): Promise<Webhook[]> {
    return this.client.request<Webhook[]>('GET', '/webhooks', undefined, options)
  }

  /**
   * Crea un webhook (201). La respuesta incluye el `secret` en PLANO **una sola
   * vez** — guárdalo; no vuelve a exponerse. Omite `secret` para que el servidor
   * genere uno seguro de 256 bits.
   */
  create(params: CreateWebhookParams, options?: RequestOptions): Promise<CreateWebhookResult> {
    return this.client.request<CreateWebhookResult>('POST', '/webhooks', params, options)
  }

  /** Actualiza un webhook (PATCH parcial; admite `isActive`). */
  update(id: string, params: UpdateWebhookParams, options?: RequestOptions): Promise<Webhook> {
    return this.client.request<Webhook>('PATCH', `/webhooks/${encodeURIComponent(id)}`, params, options)
  }

  /** Elimina un webhook (204). */
  delete(id: string, options?: RequestOptions): Promise<void> {
    return this.client.request<void>('DELETE', `/webhooks/${encodeURIComponent(id)}`, undefined, options)
  }

  /** Lista los intentos de entrega recientes de un webhook. */
  listDeliveries(id: string, options?: RequestOptions): Promise<WebhookDelivery[]> {
    return this.client.request<WebhookDelivery[]>(
      'GET',
      `/webhooks/${encodeURIComponent(id)}/deliveries`,
      undefined,
      options
    )
  }

  /** Rota el secret HMAC; invalida el anterior y devuelve el nuevo en PLANO una vez. */
  rotateSecret(id: string, options?: RequestOptions): Promise<RotateSecretResult> {
    return this.client.request<RotateSecretResult>(
      'POST',
      `/webhooks/${encodeURIComponent(id)}/rotate-secret`,
      undefined,
      options
    )
  }

  /**
   * Atajo de verificación de firma (delega en `verifyWebhook`). Lanza si la
   * firma no coincide o el timestamp está fuera de tolerancia.
   */
  verifySignature(
    rawBody: string | Buffer,
    headers: WebhookHeaders,
    secret: string,
    options?: VerifyOptions
  ): void {
    verifyWebhook(rawBody, headers, secret, options)
  }
}
