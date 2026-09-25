import { describe, it, expect } from 'vitest'
import { fetchUrl } from './fetchUrl'

describe('fetchUrl', () => {
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
