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
| `aura.vouchers.retrieve(id, options?)` | `GET /vouchers/:id` | `Voucher` |
| `aura.vouchers.list(params?, options?)` | `GET /vouchers` | `ListVouchersResult` |
| `aura.vouchers.refresh(id, options?)` | `POST /vouchers/:id/refresh` · 202 | `IssueVoucherResult` |
| `aura.vouchers.void(id, params, options?)` | `POST /vouchers/:id/void` · 202 | `IssueVoucherResult` |
| `aura.vouchers.commercialApproval(id, params, options?)` | `POST /vouchers/:id/commercial-approval` · 202 | `IssueVoucherResult` |

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
```

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

Este SDK cubre el **núcleo de emisión** — el flujo que concentra la gran mayoría de las
integraciones: emitir, consultar, listar, anular, aprobar comercialmente y verificar
webhooks.

Para lo demás (certificación de 14 pasos, contingencia, generación de la Representación
Impresa en PDF/térmica, gestión de clients y certificados, reports, retention y billing)
usa el **API REST** directamente — referencia viva en
[aura.nexo.com.do/docs](https://aura.nexo.com.do/docs).

## Enlaces

- npm: [`@nexo-do/aura-sdk`](https://www.npmjs.com/package/@nexo-do/aura-sdk)
- Repositorio e issues: [github.com/nexo-do/aura-node](https://github.com/nexo-do/aura-node)
- Producto: [nexo.com.do/aura](https://nexo.com.do/aura)
- Referencia REST (OpenAPI 3.1): [aura.nexo.com.do/docs](https://aura.nexo.com.do/docs)

## Licencia

Apache-2.0 © Nativo Digital LLC
