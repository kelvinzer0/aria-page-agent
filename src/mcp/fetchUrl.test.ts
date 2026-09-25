import { describe, it, expect, vi } from 'vitest'
import { fetchUrl } from './fetchUrl'

describe('fetchUrl SSRF', () => {
  it('blocks SSRF requests to localhost and private IPs', async () => {
    const res1 = await fetchUrl({ url: 'http://localhost:8080' })
    expect(res1.isError).toBe(true)
    expect(res1.text).toContain('SSRF Protection Blocked')

    const res2 = await fetchUrl({ url: 'http://169.254.169.254/latest/meta-data/' })
    expect(res2.isError).toBe(true)
    expect(res2.text).toContain('SSRF Protection Blocked')

    const res3 = await fetchUrl({ url: 'http://192.168.1.1' })
    expect(res3.isError).toBe(true)
    expect(res3.text).toContain('SSRF Protection Blocked')

    const res4 = await fetchUrl({ url: 'file:///etc/hosts' })
    expect(res4.isError).toBe(true)
    expect(res4.text).toContain('SSRF Protection Blocked')
  })

  it('rejects empty or invalid URLs', async () => {
    const res = await fetchUrl({ url: '' })
    expect(res.isError).toBe(true)
    expect(res.text).toContain('URL parameter is required')
  })
})

describe('fetchUrl MIME Types', () => {
  it('formats application/json into pretty json code block', async () => {
    const mockJson = { name: 'Aria Page Agent', version: '1.0.4', active: true }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(mockJson),
    }))

    const res = await fetchUrl({ url: 'https://api.example.com/status' })
    expect(res.contentType).toBe('application/json')
    expect(res.text).toContain('```json')
    expect(res.text).toContain('"name": "Aria Page Agent"')
    vi.unstubAllGlobals()
  })

  it('preserves text/plain without stripping HTML-like characters', async () => {
    const rawText = 'This is a log with <brackets> & symbols that should not be stripped.'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => rawText,
    }))

    const res = await fetchUrl({ url: 'https://example.com/log.txt' })
    expect(res.contentType).toBe('text/plain')
    expect(res.text).toContain('<brackets> & symbols')
    vi.unstubAllGlobals()
  })

  it('formats text/csv into clean Markdown table', async () => {
    const csv = 'Name,Role,Country\nAlice,Developer,ID\nBob,Designer,SG'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/csv' }),
      text: async () => csv,
    }))

    const res = await fetchUrl({ url: 'https://example.com/data.csv' })
    expect(res.contentType).toBe('text/csv')
    expect(res.text).toContain('| Name | Role | Country |')
    expect(res.text).toContain('| Alice | Developer | ID |')
    vi.unstubAllGlobals()
  })

  it('handles image/png gracefully without reading binary stream as text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png', 'content-length': '204800' }),
      text: async () => { throw new Error('Should not call text() on binary image') },
    }))

    const res = await fetchUrl({ url: 'https://example.com/photo.png' })
    expect(res.contentType).toBe('image/png')
    expect(res.text).toContain('🖼️ **Image Resource**')
    expect(res.text).toContain('![Image](https://example.com/photo.png)')
    expect(res.text).toContain('200.0 KB')
    vi.unstubAllGlobals()
  })

  it('handles application/pdf gracefully with metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf', 'content-length': '1048576' }),
      text: async () => { throw new Error('Should not call text() on binary PDF') },
    }))

    const res = await fetchUrl({ url: 'https://example.com/document.pdf' })
    expect(res.contentType).toBe('application/pdf')
    expect(res.text).toContain('📄 **PDF Document**')
    expect(res.text).toContain('1.0 MB')
    vi.unstubAllGlobals()
  })
})
