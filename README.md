# Aura SDK — Node / TypeScript

SDK oficial para emitir e-CF (facturación electrónica DGII, RD) con [Aura](https://nexo.com.do/aura).
Cero dependencias en runtime (usa el `fetch` nativo de Node ≥ 18).

- **Paquete:** [`@nexo-do/aura-sdk`](https://www.npmjs.com/package/@nexo-do/aura-sdk) (npm)
- **Repositorio:** [github.com/nexo-do/aura-node](https://github.com/nexo-do/aura-node)
- **Producto y docs:** [nexo.com.do/aura](https://nexo.com.do/aura) · [referencia REST (OpenAPI)](https://aura.nexo.com.do/docs)

## Instalación

```bash
npm install @nexo-do/aura-sdk
```

## Inicio rápido

```ts
import { Aura } from '@nexo-do/aura-sdk'

const aura = new Aura({
  apiKey: process.env.AURA_API_KEY!, // aura_test_... o aura_live_...
})

// 1) Emitir un e-CF (202 — se firma y envía a DGII de forma asíncrona)
const result = await aura.vouchers.issue(
  {
    clientId: '00000000-0000-0000-0000-000000000000',
    typeId: '31',
    counterpart: { rnc: '131234567', legalName: 'Cliente Demo SRL' },
    paymentType: 1,
    items: [{ description: 'Servicio', quantity: 1, unitPrice: 10000, itbisRate: 18 }],
  },
  { idempotencyKey: crypto.randomUUID() } // evita doble consumo de NCF en reintentos
)

console.log(result.id, result.ncf, result.status) // p.ej. ...PENDING

// 2) Consultar el estado final (o usa webhooks)
const voucher = await aura.vouchers.retrieve(result.id)
console.log(voucher.status, voucher.qrUrl, voucher.securityCode)
```

## Configuración del cliente

El constructor acepta un objeto de opciones o, como atajo, la API Key directamente:

```ts
// Equivalentes:
const aura = new Aura('aura_live_xxx')
const aura = new Aura({ apiKey: 'aura_live_xxx' })
```

| Opción | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `apiKey` *(requerido)* | `string` | — | `aura_test_…`, `aura_live_…` o legacy `aura_<hex>_…`. El modo se deriva del prefijo. |
| `baseUrl` | `string` | `https://aura.nexo.com.do/api/v1` | URL base con prefijo de versión. Self-hosted: `http://localhost:3001/v1`. |
| `timeoutMs` | `number` | `30000` | Timeout por request (ms). Aborta vía `AbortController` interno. |
| `maxRetries` | `number` | `2` | Reintentos ante transitorios (429 / 5xx / red). |
| `fetch` | `typeof fetch` | `globalThis.fetch` | `fetch` personalizado (tests, proxies). |

### El modo (test/live) sale de la API Key

No se pasa el ambiente DGII en cada request — se deriva del prefijo de la key, y lo
puedes leer con el getter `aura.mode`:

| Key | `aura.mode` | Ambiente DGII |
| --- | --- | --- |
| `aura_test_…` | `'test'` | TesteCF / CerteCF |
| `aura_live_…` | `'live'` | eCF (producción) |
| `aura_<hex>_…` (legacy) | `'legacy'` | según la key |

```ts
if (aura.mode !== 'live') console.warn('Estás emitiendo en pruebas')
```

## Recurso `vouchers`

Todos los métodos aceptan un último parámetro opcional `options` (ver
[Opciones por request](#opciones-por-request)).

| Método | HTTP | Devuelve |
| --- | --- | --- |
| `aura.vouchers.issue(params, options?)` | `POST /vouchers` · 202 | `IssueVoucherResult` |
| `aura.vouchers.issueAndWait(params, options?)` | `POST /vouchers` + polling | `Voucher` |
| `aura.vouchers.retrieve(id, options?)` | `GET /vouchers/:id` | `Voucher` |
| `aura.vouchers.list(params?, options?)` | `GET /vouchers` | `ListVouchersResult` |
| `aura.vouchers.refresh(id, options?)` | `POST /vouchers/:id/refresh` · 202 | `IssueVoucherResult` |
| `aura.vouchers.void(id, params, options?)` | `POST /vouchers/:id/void` · 202 | `IssueVoucherResult` |
| `aura.vouchers.commercialApproval(id, params, options?)` | `POST /vouchers/:id/commercial-approval` · 202 | `CommercialApprovalResult` |
| `aura.vouchers.receive(params, options?)` | `POST /vouchers/receive` · 201 | `ReceiveVoucherResult` |

```ts
// Emitir (202 — async). Pasa idempotencyKey para que un reintento no consuma un NCF nuevo.
await aura.vouchers.issue(params, { idempotencyKey: crypto.randomUUID() })

// Consultar uno (incluye items, qrUrl, securityCode, estado DGII)
await aura.vouchers.retrieve(id)

// Listar con filtros y paginación → { items, total, totalCapped, limit, offset }
await aura.vouchers.list({ clientId, status: 'ACCEPTED', from: '2026-01-01', limit: 50, offset: 0 })

// Forzar re-consulta del estado en DGII (202)
await aura.vouchers.refresh(id)

// Anular vía ANECF (202). reason: 10–500 chars; modificationCode: Tabla VI DGII (obligatorio)
await aura.vouchers.void(id, { reason: 'Cliente canceló la compra', modificationCode: 1 })

// Aprobación comercial (ACECF) sobre un e-CF recibido (202)
await aura.vouchers.commercialApproval(id, { status: 'ACCEPTED' })

// Registrar un e-CF RECIBIDO de un proveedor (origin=RECEIVED, dispara webhook voucher.received)
await aura.vouchers.receive({ clientId, signedXml })
```

#### `issueAndWait` — emitir y esperar el QR

`issue` devuelve 202 y la firma ocurre asíncrona: `qrUrl` y `securityCode` (lo que
necesitas para imprimir la Representación Impresa) llegan después, por `GET`/webhook.
Cuando necesitas el QR **en el mismo flujo** (p.ej. imprimir el ticket al cerrar la
venta), usa `issueAndWait`: emite y hace polling hasta tener la firma o agotar el tiempo.

```ts
const voucher = await aura.vouchers.issueAndWait(params, {
  idempotencyKey: crypto.randomUUID(),
  timeoutMs: 8000,  // máximo de espera (default 8000)
  intervalMs: 350,  // intervalo de polling (default 350)
})

if (voucher.qrUrl) {
  printTicket(voucher) // ya tiene qrUrl + securityCode
} else {
  // se agotó el tiempo sin firma: el webhook `voucher.signed` la completará
}
```

- Lanza `AuraError` (`type: 'DGII_REJECTED'`) si DGII rechaza el comprobante (el detalle
  va en `error.details` / `error.message`).
- Si se agota `timeoutMs` sin firma, **no lanza**: devuelve el último estado conocido
  (sin `qrUrl`) para que continúes por webhook.

Esto reproduce el comportamiento del gateway de Backend/API (ver
[MIGRATION-from-gateway.md](./MIGRATION-from-gateway.md)).

El payload de `issue` (`IssueVoucherParams`) es mucho más rico que el ejemplo: soporta
desglose por medio de pago, retenciones por línea (ISR/ITBIS), ISC y alcoholes,
multimoneda (`currency` + `exchangeRate`), referencias para NC/ND, información adicional
de transporte y paginación de la Representación Impresa. Todo está **tipado** —
deja que el autocompletado de TypeScript te guíe, o revisa
[`src/types.ts`](https://github.com/nexo-do/aura-node/blob/main/src/types.ts).

### Opciones por request

Todos los métodos aceptan un objeto `RequestOptions`:

| Campo | Tipo | Aplica a | Descripción |
| --- | --- | --- | --- |
| `idempotencyKey` | `string` | emisión | Header `Idempotency-Key` (8–100 chars ASCII). Evita doble consumo de NCF y habilita reintentos seguros. |
| `signal` | `AbortSignal` | todos | Cancela el request (además del timeout interno). |

```ts
const ac = new AbortController()
setTimeout(() => ac.abort(), 2000)
await aura.vouchers.list({ limit: 200 }, { signal: ac.signal })
```

## Recurso `clients` (provisioning)

Gestión de **emisores RNC**, su certificado P12 y sus **secuencias NCF**. Es la
superficie de aprovisionamiento, separada del flujo de emisión.

| Método | HTTP | Devuelve |
| --- | --- | --- |
| `aura.clients.create(params, options?)` | `POST /clients` · 201 | `Client` |
| `aura.clients.list(options?)` | `GET /clients` | `Client[]` |
| `aura.clients.retrieve(id, options?)` | `GET /clients/:id` | `Client` |
| `aura.clients.update(id, params, options?)` | `PATCH /clients/:id` | `Client` |
| `aura.clients.uploadCertificate(id, params, options?)` | `POST /clients/:id/certificate` | `UploadCertificateResult` |
| `aura.clients.sequences.list(clientId, options?)` | `GET /clients/:id/sequences` | `Sequence[]` |
| `aura.clients.sequences.create(clientId, params, options?)` | `POST /clients/:id/sequences` · 201 | `Sequence` |
| `aura.clients.sequences.update(clientId, seqId, params, options?)` | `PATCH …/sequences/:seqId` | `Sequence` |
| `aura.clients.sequences.delete(clientId, seqId, options?)` | `DELETE …/sequences/:seqId` | `DeleteResult` |

```ts
// 1) Crear el emisor
const client = await aura.clients.create({
  rnc: '131234567',
  legalName: 'Cliente Demo SRL',
  address: 'Av. Winston Churchill 100, Santo Domingo',
  activeEnv: 'TesteCF',
})

// 2) Subir su certificado P12 (base64). Material sensible → solo HTTPS, nunca se loguea.
import { readFileSync } from 'node:fs'
const { expiresAt } = await aura.clients.uploadCertificate(client.id, {
  p12Base64: readFileSync('cert.p12').toString('base64'),
  password: process.env.P12_PASSWORD!,
})

// 3) Registrar un rango NCF. Omite expireAt para rangos sin vencimiento (E32/E34).
await aura.clients.sequences.create(client.id, {
  typeId: '31', env: 'TesteCF', startOn: 1, stopOn: 1000, expireAt: '2026-12-31',
})

// Editar: expireAt:null BORRA el vencimiento; omitirlo lo deja igual. typeId/env son inmutables.
await aura.clients.sequences.update(client.id, seqId, { stopOn: 2000, expireAt: null })
```

> El **modo (test/live) sale de la API Key**, pero las operaciones de gestión (crear
> client, secuencias, certificado) las haces normalmente con la key **live** del project.
> Instancia un `Aura` con la key correcta según el ambiente que estés aprovisionando.

## Recurso `webhooks` (gestión de suscripciones)

Alta/baja/listado de webhooks y rotación de secret. **No confundir** con `verifyWebhook`
(verificación de firma de webhooks entrantes, más abajo).

| Método | HTTP | Devuelve |
| --- | --- | --- |
| `aura.webhooks.create(params, options?)` | `POST /webhooks` · 201 | `CreateWebhookResult` (incluye `secret` una vez) |
| `aura.webhooks.list(options?)` | `GET /webhooks` | `Webhook[]` (nunca expone el secret) |
| `aura.webhooks.update(id, params, options?)` | `PATCH /webhooks/:id` | `Webhook` |
| `aura.webhooks.delete(id, options?)` | `DELETE /webhooks/:id` · 204 | `void` |
| `aura.webhooks.listDeliveries(id, options?)` | `GET /webhooks/:id/deliveries` | `WebhookDelivery[]` |
| `aura.webhooks.rotateSecret(id, options?)` | `POST /webhooks/:id/rotate-secret` | `RotateSecretResult` |
| `aura.webhooks.verifySignature(rawBody, headers, secret, options?)` | — (local) | `void` |

```ts
// Crear: el `secret` se devuelve en PLANO UNA sola vez — guárdalo ya.
const wh = await aura.webhooks.create({
  name: 'Nexo prod',
  url: 'https://api.nexo.com.do/v2/aura/webhook',
  events: ['voucher.accepted', 'voucher.rejected', 'voucher.voided'],
  mode: 'live', // solo eventos eCF; usa 'test' para pruebas, omite para todos
})
await saveSecret(wh.id, wh.secret) // no vuelve a exponerse

// Rotar el secret (invalida el anterior)
const { secret } = await aura.webhooks.rotateSecret(wh.id)
```

Los `events` están **tipados** (`WebhookEvent`) y se exporta el catálogo canónico como
`WEBHOOK_EVENTS`.

## Manejo de errores

Todo error del API se lanza como `AuraError`:

```ts
import { AuraError } from '@nexo-do/aura-sdk'

try {
  await aura.vouchers.issue(params)
} catch (e) {
  if (e instanceof AuraError) {
    console.error(e.type, e.message)
    console.error('HTTP', e.status, '· requestId', e.requestId)
    if (e.isRetryable) {
      /* transitorio: reintenta más tarde */
    }
  }
}
```

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `type` | `AuraErrorType` | Tipo canónico del error (ver lista abajo). |
| `title` | `string` | Título corto legible. |
| `message` | `string` | Mensaje accionable (heredado de `Error`). |
| `status` | `number` | Código HTTP. `0` si es error de red (antes de recibir respuesta). |
| `details` | `unknown` | Detalles del backend (p.ej. validaciones por campo), si los hay. |
| `requestId` | `string \| undefined` | ID de correlación del backend — inclúyelo al reportar incidencias. |
| `isRetryable` | `boolean` *(getter)* | `true` para transitorios (ver abajo). |

`AuraErrorType` puede ser: `VALIDATION`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`CONFLICT`, `RATE_LIMITED`, `DGII_UNAVAILABLE`, `DGII_REJECTED`, `CERTIFICATE_ERROR`,
`SEQUENCE_EXHAUSTED`, `SERVICE_UNAVAILABLE`, `INTERNAL` o `NETWORK`.

**Reintentos automáticos.** El cliente reintenta `RATE_LIMITED`, `DGII_UNAVAILABLE`,
`SERVICE_UNAVAILABLE`, errores de red y cualquier `5xx`, hasta `maxRetries` veces, con
backoff exponencial (respetando el header `Retry-After`). Solo reintenta operaciones
seguras: **GETs** y **emisiones que llevan `idempotencyKey`** — nunca una mutación no
idempotente.

## Verificar webhooks

Aura firma cada webhook con HMAC-SHA256 sobre `${timestamp}.${delivery}.${rawBody}` y
añade una ventana anti-replay. Verifica **siempre con el cuerpo crudo** (no lo parsees
antes).

```ts
import { verifyWebhook } from '@nexo-do/aura-sdk'

app.post('/aura/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    verifyWebhook(
      req.body, // Buffer CRUDO — no JSON.parse antes
      {
        signature: req.header('X-ECF-Signature'), // sha256=<hex>
        timestamp: req.header('X-ECF-Timestamp'), // epoch en ms
        delivery: req.header('X-ECF-Delivery'),   // id del intento
      },
      process.env.AURA_WEBHOOK_SECRET!
    )
  } catch {
    return res.status(401).end()
  }
  const event = JSON.parse(req.body.toString())
  // event.type: 'voucher.accepted' | 'voucher.rejected' | 'voucher.voided' | ...
  res.status(200).end()
})
```

`verifyWebhook(rawBody, headers, secret, options?)` **lanza** si la firma no coincide o
el timestamp está fuera de tolerancia. Si prefieres un booleano, usa `isValidWebhook(...)`
con la misma firma:

```ts
import { isValidWebhook } from '@nexo-do/aura-sdk'

if (!isValidWebhook(req.body, headers, secret)) return res.status(401).end()
```

La ventana anti-replay es de **±5 minutos** por defecto; ajústala con
`options.toleranceSeconds`:

```ts
verifyWebhook(req.body, headers, secret, { toleranceSeconds: 600 })
```

## Tipos

Todos los tipos del dominio se exportan desde el paquete y vienen con el SDK
(`IssueVoucherParams`, `Voucher`, `EcfItem`, `Counterpart`, `ListVouchersParams`,
`AuraErrorType`, `WebhookHeaders`, etc.). Reflejan los schemas Zod del backend, así que
el autocompletado y el chequeo de tipos te cubren la superficie completa de cada payload.

```ts
import type { IssueVoucherParams, Voucher, EcfTypeId } from '@nexo-do/aura-sdk'
```

## Alcance

Este SDK cubre **toda la superficie de Aura que consume una integración de emisión + recepción
+ provisioning**:

- **Emisión** — `vouchers`: `issue` / `issueAndWait`, `retrieve`, `list`, `refresh`, `void`
  (ANECF), `commercialApproval` (ACECF), `receive`.
- **Provisioning** — `clients`: alta/edición/consulta, `uploadCertificate`, y `sequences`
  (CRUD de rangos NCF).
- **Webhooks** — gestión de suscripciones (`webhooks.*`) + verificación de firma
  (`verifyWebhook` / `aura.webhooks.verifySignature`).

Cubre el 100% de los endpoints que usa el gateway e-CF de Backend/API — ver el mapeo
1:1 en [MIGRATION-from-gateway.md](./MIGRATION-from-gateway.md).

Lo que **no** cubre (usa el **API REST** directamente — referencia viva en
[aura.nexo.com.do/docs](https://aura.nexo.com.do/docs)): certificación de 14 pasos,
contingencia, generación de la Representación Impresa en PDF/térmica, reports, retention
y billing.

## Enlaces

- npm: [`@nexo-do/aura-sdk`](https://www.npmjs.com/package/@nexo-do/aura-sdk)
- Repositorio e issues: [github.com/nexo-do/aura-node](https://github.com/nexo-do/aura-node)
- Producto: [nexo.com.do/aura](https://nexo.com.do/aura)
- Referencia REST (OpenAPI 3.1): [aura.nexo.com.do/docs](https://aura.nexo.com.do/docs)

## Licencia

Apache-2.0 © Nativo Digital LLC
