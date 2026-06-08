/** Tipos canónicos de error del API de Aura (`utils/errors.ts` del backend). */
export type AuraErrorType =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'DGII_UNAVAILABLE'
  | 'DGII_REJECTED'
  | 'CERTIFICATE_ERROR'
  | 'SEQUENCE_EXHAUSTED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL'
  | 'NETWORK'

/**
 * Error tipado del API de Aura. El backend responde
 * `{ error: { type, title, message, details }, requestId }`.
 */
export class AuraError extends Error {
  readonly type: AuraErrorType
  readonly title: string
  /** Código HTTP (0 si el error es de red, antes de recibir respuesta). */
  readonly status: number
  readonly details?: unknown
  /** `requestId` del backend — inclúyelo al reportar incidencias. */
  readonly requestId?: string

  constructor(init: {
    type: AuraErrorType
    title: string
    message: string
    status: number
    details?: unknown
    requestId?: string
  }) {
    super(init.message)
    this.name = 'AuraError'
    this.type = init.type
    this.title = init.title
    this.status = init.status
    this.details = init.details
    this.requestId = init.requestId
  }

  /** Errores transitorios que tiene sentido reintentar. */
  get isRetryable(): boolean {
    return (
      this.type === 'RATE_LIMITED' ||
      this.type === 'DGII_UNAVAILABLE' ||
      this.type === 'SERVICE_UNAVAILABLE' ||
      this.type === 'NETWORK' ||
      this.status >= 500
    )
  }
}
