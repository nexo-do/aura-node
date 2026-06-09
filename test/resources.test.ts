import { describe, it, expect, vi } from 'vitest'
import { Aura, AuraError } from '../src/index.js'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

/** Crea un Aura con un fetch que registra cada llamada y responde por función. */
function clientWith(responder: (url: string, init: RequestInit, n: number) => Response) {
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = []
  let n = 0
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method as string,
      body: init.body ? JSON.parse(init.body as string) : undefined,
      headers: init.headers as Record<string, string>
    })
    return responder(url, init, n++)
  })
  const aura = new Aura({ apiKey: 'aura_test_k', maxRetries: 0, fetch: fetchMock as unknown as typeof fetch })
  return { aura, calls, fetchMock }
}

describe('clients', () => {
  it('create → POST /clients (201)', async () => {
    const { aura, calls } = clientWith(() => jsonResponse(201, { id: 'cl1', rnc: '131234567', legalName: 'Demo SRL' }))
    const c = await aura.clients.create({ rnc: '131234567', legalName: 'Demo SRL', address: 'Calle 1' })
    expect(c.id).toBe('cl1')
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringContaining('/clients') })
    expect(calls[0].body).toMatchObject({ rnc: '131234567', address: 'Calle 1' })
  })

  it('retrieve / list / update', async () => {
    const { aura, calls } = clientWith((url, init) => {
      if (init.method === 'GET' && url.endsWith('/clients')) return jsonResponse(200, [{ id: 'cl1' }])
      if (init.method === 'GET') return jsonResponse(200, { id: 'cl1', isActive: true })
      return jsonResponse(200, { id: 'cl1', legalName: 'Nuevo' })
    })
    expect(await aura.clients.list()).toHaveLength(1)
    expect((await aura.clients.retrieve('cl1')).isActive).toBe(true)
    const upd = await aura.clients.update('cl1', { legalName: 'Nuevo' })
    expect(upd.legalName).toBe('Nuevo')
    expect(calls[2]).toMatchObject({ method: 'PATCH' })
  })

  it('uploadCertificate → POST /clients/:id/certificate', async () => {
    const { aura, calls } = clientWith(() => jsonResponse(200, { ok: true, expiresAt: '2027-01-01T00:00:00Z' }))
    const res = await aura.clients.uploadCertificate('cl1', { p12Base64: 'AAAA', password: 'x' })
    expect(res).toMatchObject({ ok: true, expiresAt: '2027-01-01T00:00:00Z' })
    expect(calls[0].url).toContain('/clients/cl1/certificate')
    expect(calls[0].body).toMatchObject({ p12Base64: 'AAAA' })
  })
})

describe('sequences', () => {
  it('list / create / update(expireAt:null) / delete', async () => {
    const { aura, calls } = clientWith((url, init) => {
      if (init.method === 'GET') return jsonResponse(200, [{ id: 's1', typeId: '31' }])
      if (init.method === 'POST') return jsonResponse(201, { id: 's1', typeId: '31', currentNumber: 1 })
      if (init.method === 'PATCH') return jsonResponse(200, { id: 's1', expireAt: null })
      return jsonResponse(200, { ok: true }) // DELETE
    })
    expect(await aura.clients.sequences.list('cl1')).toHaveLength(1)
    await aura.clients.sequences.create('cl1', { typeId: '31', env: 'eCF', startOn: 1, stopOn: 100 })
    const upd = await aura.clients.sequences.update('cl1', 's1', { expireAt: null })
    expect(upd.expireAt).toBeNull()
    const del = await aura.clients.sequences.delete('cl1', 's1')
    expect(del.ok).toBe(true)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'PATCH', 'DELETE'])
    // expireAt:null debe serializarse (no omitirse) para borrar el vencimiento
    expect(JSON.stringify(calls[2].body)).toContain('"expireAt":null')
  })
})

describe('webhooks (management)', () => {
  it('create devuelve el secret una vez', async () => {
    const { aura, calls } = clientWith(() =>
      jsonResponse(201, { id: 'wh1', name: 'n', url: 'https://x', events: ['voucher.accepted'], isActive: true, hasSecret: true, secret: 'whsec_abc' })
    )
    const wh = await aura.webhooks.create({ name: 'n', url: 'https://x', events: ['voucher.accepted'], mode: 'live' })
    expect(wh.secret).toBe('whsec_abc')
    expect(calls[0].body).toMatchObject({ mode: 'live', events: ['voucher.accepted'] })
  })

  it('delete → 204 (sin body)', async () => {
    const { aura, calls } = clientWith(() => new Response(null, { status: 204 }))
    const r = await aura.webhooks.delete('wh1')
    expect(r).toBeUndefined()
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/webhooks/wh1') })
  })

  it('rotateSecret / listDeliveries', async () => {
    const { aura } = clientWith((url) =>
      url.includes('rotate-secret')
        ? jsonResponse(200, { id: 'wh1', secret: 'whsec_new' })
        : jsonResponse(200, [{ id: 'd1', event: 'voucher.accepted', status: 'SUCCESS' }])
    )
    expect((await aura.webhooks.rotateSecret('wh1')).secret).toBe('whsec_new')
    expect(await aura.webhooks.listDeliveries('wh1')).toHaveLength(1)
  })
})

describe('vouchers.receive', () => {
  it('POST /vouchers/receive', async () => {
    const { aura, calls } = clientWith(() => jsonResponse(201, { voucherId: 'v9' }))
    const r = await aura.vouchers.receive({ clientId: 'cl1', signedXml: '<ECF>...</ECF>'.padEnd(60, '.') })
    expect(r.voucherId).toBe('v9')
    expect(calls[0].url).toContain('/vouchers/receive')
  })
})

describe('vouchers.issueAndWait', () => {
  it('polea hasta obtener qrUrl + securityCode', async () => {
    const { aura } = clientWith((url, init, n) => {
      if (init.method === 'POST' && url.endsWith('/vouchers')) return jsonResponse(202, { id: 'v1', ncf: 'E31', status: 'PENDING' })
      // primer GET sin firma, segundo con qr
      return n < 2
        ? jsonResponse(200, { id: 'v1', ncf: 'E31', status: 'IN_PROCESS' })
        : jsonResponse(200, { id: 'v1', ncf: 'E31', status: 'ACCEPTED', qrUrl: 'https://qr', securityCode: 'ABC123' })
    })
    const v = await aura.vouchers.issueAndWait(
      { clientId: 'c', typeId: '31', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] },
      { idempotencyKey: 'k', intervalMs: 1, timeoutMs: 2000 }
    )
    expect(v.qrUrl).toBe('https://qr')
    expect(v.securityCode).toBe('ABC123')
  })

  it('lanza AuraError si DGII rechaza', async () => {
    const { aura } = clientWith((url, init) => {
      if (init.method === 'POST') return jsonResponse(202, { id: 'v1', ncf: 'E31', status: 'PENDING' })
      return jsonResponse(200, { id: 'v1', ncf: 'E31', status: 'REJECTED', dgiiMessages: [{ codigo: 2, valor: 'RNC inválido' }] })
    })
    await expect(
      aura.vouchers.issueAndWait(
        { clientId: 'c', typeId: '31', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] },
        { idempotencyKey: 'k', intervalMs: 1, timeoutMs: 2000 }
      )
    ).rejects.toMatchObject({ type: 'DGII_REJECTED' })
  })

  it('devuelve estado parcial si se agota el timeout sin firma', async () => {
    const { aura } = clientWith((url, init) => {
      if (init.method === 'POST') return jsonResponse(202, { id: 'v1', ncf: 'E31', status: 'PENDING' })
      return jsonResponse(200, { id: 'v1', ncf: 'E31', status: 'IN_PROCESS' })
    })
    const v = await aura.vouchers.issueAndWait(
      { clientId: 'c', typeId: '31', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] },
      { idempotencyKey: 'k', intervalMs: 1, timeoutMs: 30 }
    )
    expect(v.status).toBe('IN_PROCESS')
    expect(v.qrUrl).toBeUndefined()
  })
})
