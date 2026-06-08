import { describe, it, expect, vi } from 'vitest'
import crypto from 'node:crypto'
import { Aura, AuraError, verifyWebhook, isValidWebhook } from '../src/index.js'

/** Helper: fake fetch que devuelve una Response JSON. */
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

function sign(secret: string, ts: string, delivery: string, body: string) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${delivery}.${body}`).digest('hex')
}

describe('mode', () => {
  it('deriva test/live/legacy del prefijo de la key', () => {
    expect(new Aura('aura_test_x_y').mode).toBe('test')
    expect(new Aura('aura_live_x_y').mode).toBe('live')
    expect(new Aura('aura_abc_y').mode).toBe('legacy')
  })

  it('exige apiKey', () => {
    expect(() => new Aura('')).toThrow(/apiKey/)
  })
})

describe('request building', () => {
  it('envía X-API-Key, Idempotency-Key y serializa el body', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      expect(headers['X-API-Key']).toBe('aura_test_k')
      expect(headers['Idempotency-Key']).toBe('idem-1')
      expect(JSON.parse(init.body as string)).toMatchObject({ typeId: '31' })
      return jsonResponse(202, { id: 'v1', ncf: 'E310000000001', status: 'PENDING' })
    })
    const aura = new Aura({ apiKey: 'aura_test_k', fetch: fetchMock as unknown as typeof fetch })

    const res = await aura.vouchers.issue(
      { clientId: 'c1', typeId: '31', items: [{ description: 'X', quantity: 1, unitPrice: 100 }] },
      { idempotencyKey: 'idem-1' }
    )
    expect(res).toMatchObject({ id: 'v1', status: 'PENDING' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('serializa filtros de list como query string', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/vouchers?')
      expect(url).toContain('limit=10')
      expect(url).toContain('status=ACCEPTED')
      return jsonResponse(200, { items: [], total: 0, totalCapped: false, limit: 10, offset: 0 })
    })
    const aura = new Aura({ apiKey: 'aura_test_k', fetch: fetchMock as unknown as typeof fetch })
    await aura.vouchers.list({ limit: 10, status: 'ACCEPTED' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('error mapping', () => {
  it('mapea { error } del backend a AuraError tipado', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, { error: { type: 'VALIDATION', title: 'Datos inválidos', message: 'falla' }, requestId: 'req-9' })
    )
    const aura = new Aura({ apiKey: 'aura_test_k', maxRetries: 0, fetch: fetchMock as unknown as typeof fetch })

    await expect(aura.vouchers.retrieve('x')).rejects.toMatchObject({
      type: 'VALIDATION',
      status: 400,
      requestId: 'req-9'
    })
    try {
      await aura.vouchers.retrieve('x')
    } catch (e) {
      expect(e).toBeInstanceOf(AuraError)
      expect((e as AuraError).isRetryable).toBe(false)
    }
  })

  it('infiere el tipo desde el status si el body no trae error', async () => {
    const fetchMock = vi.fn(async () => new Response('not json', { status: 503 }))
    const aura = new Aura({ apiKey: 'aura_test_k', maxRetries: 0, fetch: fetchMock as unknown as typeof fetch })
    await expect(aura.vouchers.retrieve('x')).rejects.toMatchObject({ type: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

describe('retries', () => {
  it('reintenta 503 en GET y termina con éxito', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls++
      if (calls < 3) return jsonResponse(503, { error: { type: 'SERVICE_UNAVAILABLE', title: 't', message: 'm' } })
      return jsonResponse(200, { id: 'ok' })
    })
    const aura = new Aura({ apiKey: 'aura_test_k', maxRetries: 3, fetch: fetchMock as unknown as typeof fetch })
    // backoff real es lento; usamos fake timers
    vi.useFakeTimers()
    const p = aura.vouchers.retrieve('x')
    await vi.runAllTimersAsync()
    const res = await p
    vi.useRealTimers()
    expect(res).toMatchObject({ id: 'ok' })
    expect(calls).toBe(3)
  })

  it('NO reintenta POST sin idempotencyKey', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls++
      return jsonResponse(503, { error: { type: 'SERVICE_UNAVAILABLE', title: 't', message: 'm' } })
    })
    const aura = new Aura({ apiKey: 'aura_test_k', maxRetries: 3, fetch: fetchMock as unknown as typeof fetch })
    await expect(
      aura.vouchers.issue({ clientId: 'c', typeId: '31', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] })
    ).rejects.toBeInstanceOf(AuraError)
    expect(calls).toBe(1)
  })
})

describe('webhooks', () => {
  const secret = 'whsec'
  const body = JSON.stringify({ type: 'voucher.accepted' })

  it('acepta una firma válida', () => {
    const ts = String(Date.now())
    const sig = sign(secret, ts, 'd1', body)
    expect(() =>
      verifyWebhook(body, { signature: sig, timestamp: ts, delivery: 'd1' }, secret)
    ).not.toThrow()
    expect(isValidWebhook(body, { signature: sig, timestamp: ts, delivery: 'd1' }, secret)).toBe(true)
  })

  it('rechaza firma inválida', () => {
    const ts = String(Date.now())
    expect(isValidWebhook(body, { signature: 'sha256=bad', timestamp: ts, delivery: 'd1' }, secret)).toBe(false)
  })

  it('rechaza timestamp fuera de tolerancia (anti-replay)', () => {
    const ts = String(Date.now() - 10 * 60 * 1000) // 10 min atrás
    const sig = sign(secret, ts, 'd1', body)
    expect(() => verifyWebhook(body, { signature: sig, timestamp: ts, delivery: 'd1' }, secret)).toThrow(/anti-replay/)
  })

  it('exige headers de firma y timestamp', () => {
    expect(() => verifyWebhook(body, { timestamp: String(Date.now()) }, secret)).toThrow(/X-ECF-Signature/)
    expect(() => verifyWebhook(body, { signature: 'sha256=x' }, secret)).toThrow(/X-ECF-Timestamp/)
  })
})
