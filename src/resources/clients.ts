import type { Aura, RequestOptions } from '../client.js'
import type {
  Client,
  CreateClientParams,
  UpdateClientParams,
  UploadCertificateParams,
  UploadCertificateResult,
  Sequence,
  CreateSequenceParams,
  UpdateSequenceParams,
  DeleteResult
} from '../types.js'

/**
 * Gestión de clientes (emisores RNC), su certificado P12 y sus secuencias NCF.
 * Es la superficie de **provisioning** — separada del flujo de emisión (`vouchers`).
 */
export class Clients {
  /** Operaciones sobre las secuencias/rangos NCF de un cliente. */
  readonly sequences: Sequences

  constructor(private readonly client: Aura) {
    this.sequences = new Sequences(client)
  }

  /** Crea un cliente emisor (201). Devuelve el `id` con el que emites vouchers. */
  create(params: CreateClientParams, options?: RequestOptions): Promise<Client> {
    return this.client.request<Client>('POST', '/clients', params, options)
  }

  /** Lista los clientes del project. */
  list(options?: RequestOptions): Promise<Client[]> {
    return this.client.request<Client[]>('GET', '/clients', undefined, options)
  }

  /** Obtiene un cliente por id (incluye estado de contingencia y vencimiento del cert). */
  retrieve(id: string, options?: RequestOptions): Promise<Client> {
    return this.client.request<Client>('GET', `/clients/${encodeURIComponent(id)}`, undefined, options)
  }

  /** Actualiza campos del cliente (PATCH parcial). */
  update(id: string, params: UpdateClientParams, options?: RequestOptions): Promise<Client> {
    return this.client.request<Client>('PATCH', `/clients/${encodeURIComponent(id)}`, params, options)
  }

  /**
   * Sube el certificado PKCS#12 del cliente (cifrado at-rest en Aura).
   * `p12Base64` es el .p12 en base64; `password` su clave. Devuelve `{ ok, expiresAt }`.
   *
   * ⚠️ Material sensible: el secreto nunca se loguea. Envía solo sobre HTTPS.
   */
  uploadCertificate(
    id: string,
    params: UploadCertificateParams,
    options?: RequestOptions
  ): Promise<UploadCertificateResult> {
    return this.client.request<UploadCertificateResult>(
      'POST',
      `/clients/${encodeURIComponent(id)}/certificate`,
      params,
      options
    )
  }
}

/** Secuencias NCF de un cliente — colgadas de `aura.clients.sequences`. */
export class Sequences {
  constructor(private readonly client: Aura) {}

  /** Lista las secuencias del cliente. */
  list(clientId: string, options?: RequestOptions): Promise<Sequence[]> {
    return this.client.request<Sequence[]>(
      'GET',
      `/clients/${encodeURIComponent(clientId)}/sequences`,
      undefined,
      options
    )
  }

  /** Crea un rango NCF (201). Omite `expireAt` para rangos sin vencimiento (E32/E34). */
  create(clientId: string, params: CreateSequenceParams, options?: RequestOptions): Promise<Sequence> {
    return this.client.request<Sequence>(
      'POST',
      `/clients/${encodeURIComponent(clientId)}/sequences`,
      params,
      options
    )
  }

  /**
   * Actualiza un rango. `typeId`/`env` son inmutables. `expireAt: null` **borra**
   * el vencimiento; omitirlo lo deja igual.
   */
  update(
    clientId: string,
    seqId: string,
    params: UpdateSequenceParams,
    options?: RequestOptions
  ): Promise<Sequence> {
    return this.client.request<Sequence>(
      'PATCH',
      `/clients/${encodeURIComponent(clientId)}/sequences/${encodeURIComponent(seqId)}`,
      params,
      options
    )
  }

  /** Elimina un rango (solo si nunca se usó). */
  delete(clientId: string, seqId: string, options?: RequestOptions): Promise<DeleteResult> {
    return this.client.request<DeleteResult>(
      'DELETE',
      `/clients/${encodeURIComponent(clientId)}/sequences/${encodeURIComponent(seqId)}`,
      undefined,
      options
    )
  }
}
