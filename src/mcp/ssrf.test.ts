import { describe, it, expect } from 'vitest'
import { validateUrlSSRF } from './ssrf'

describe('validateUrlSSRF', () => {
  it('allows safe public URLs', () => {
    expect(validateUrlSSRF('https://example.com').safe).toBe(true)
    expect(validateUrlSSRF('https://api.github.com/repos').safe).toBe(true)
    expect(validateUrlSSRF('http://wikipedia.org').safe).toBe(true)
    expect(validateUrlSSRF('https://example.com:8080/path').safe).toBe(true)
  })

  it('blocks non-HTTP protocols', () => {
    expect(validateUrlSSRF('file:///etc/passwd').safe).toBe(false)
    expect(validateUrlSSRF('chrome://settings').safe).toBe(false)
    expect(validateUrlSSRF('javascript:alert(1)').safe).toBe(false)
    expect(validateUrlSSRF('data:text/html,<h1>Hello</h1>').safe).toBe(false)
    expect(validateUrlSSRF('ftp://files.example.com').safe).toBe(false)
  })

  it('blocks localhost and internal domains', () => {
    expect(validateUrlSSRF('http://localhost').safe).toBe(false)
    expect(validateUrlSSRF('http://localhost:3000').safe).toBe(false)
    expect(validateUrlSSRF('http://service.local').safe).toBe(false)
    expect(validateUrlSSRF('http://api.internal').safe).toBe(false)
    expect(validateUrlSSRF('http://router.lan').safe).toBe(false)
    expect(validateUrlSSRF('http://server.home').safe).toBe(false)
  })

  it('blocks loopback IPv4', () => {
    expect(validateUrlSSRF('http://127.0.0.1').safe).toBe(false)
    expect(validateUrlSSRF('http://127.0.0.2:8080').safe).toBe(false)
    expect(validateUrlSSRF('http://127.127.127.127').safe).toBe(false)
    expect(validateUrlSSRF('http://0.0.0.0').safe).toBe(false)
  })

  it('blocks cloud metadata 169.254.169.254', () => {
    expect(validateUrlSSRF('http://169.254.169.254/latest/meta-data/').safe).toBe(false)
    expect(validateUrlSSRF('http://169.254.1.1').safe).toBe(false)
  })

  it('blocks private class A, B, C IPs', () => {
    expect(validateUrlSSRF('http://10.0.0.1').safe).toBe(false)
    expect(validateUrlSSRF('http://10.254.254.254').safe).toBe(false)
    expect(validateUrlSSRF('http://172.16.0.1').safe).toBe(false)
    expect(validateUrlSSRF('http://172.31.255.255').safe).toBe(false)
    expect(validateUrlSSRF('http://192.168.1.1').safe).toBe(false)
    expect(validateUrlSSRF('http://192.168.0.100').safe).toBe(false)
  })

  it('blocks IPv6 loopback and unique-local', () => {
    expect(validateUrlSSRF('http://[::1]').safe).toBe(false)
    expect(validateUrlSSRF('http://[::]').safe).toBe(false)
    expect(validateUrlSSRF('http://[fc00::1]').safe).toBe(false)
    expect(validateUrlSSRF('http://[fe80::1]').safe).toBe(false)
  })

  it('blocks sensitive internal service ports', () => {
    expect(validateUrlSSRF('http://example.com:22').safe).toBe(false)
    expect(validateUrlSSRF('http://example.com:6379').safe).toBe(false)
    expect(validateUrlSSRF('http://example.com:27017').safe).toBe(false)
    expect(validateUrlSSRF('http://example.com:2375').safe).toBe(false)
  })
})
