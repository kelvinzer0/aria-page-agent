import { describe, it, expect } from 'vitest'
import { parseGoogleSearchResults, parseDuckDuckGoResults } from './webSearch'

describe('parseGoogleSearchResults', () => {
  it('parses Google search result cards into title, link, and snippet', () => {
    const html = `
      <div class="MjjYud">
        <div>
          <a href="https://example.com/guide">
            <h3>Complete Guide to Web Scraping</h3>
          </a>
        </div>
        <div class="VwiC3b">Learn everything you need to know about parsing web data efficiently in 2026.</div>
      </div>
      <div class="MjjYud">
        <div>
          <a href="/url?q=https://docs.api.org/overview&sa=U">
            <h3>API Documentation & Reference</h3>
          </a>
        </div>
        <div class="VwiC3b">Explore our comprehensive REST and WebSocket API endpoints.</div>
      </div>
    `
    const results = parseGoogleSearchResults(html)
    expect(results.length).toBe(2)
    expect(results[0].title).toBe('Complete Guide to Web Scraping')
    expect(results[0].link).toBe('https://example.com/guide')
    expect(results[0].snippet).toContain('Learn everything you need to know')

    expect(results[1].title).toBe('API Documentation & Reference')
    expect(results[1].link).toBe('https://docs.api.org/overview')
    expect(results[1].snippet).toContain('Explore our comprehensive REST')
  })

  it('filters out Google internal links and duplicates', () => {
    const html = `
      <div class="MjjYud">
        <a href="https://google.com/search?q=test"><h3>Google Search</h3></a>
      </div>
      <div class="MjjYud">
        <a href="https://support.google.com/websearch"><h3>Help</h3></a>
      </div>
      <div class="MjjYud">
        <a href="https://valid-target.com/page"><h3>Valid Target</h3></a>
        <div class="VwiC3b">Valid snippet content here.</div>
      </div>
      <div class="MjjYud">
        <a href="https://valid-target.com/page"><h3>Duplicate Valid Target</h3></a>
      </div>
    `
    const results = parseGoogleSearchResults(html)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Valid Target')
    expect(results[0].link).toBe('https://valid-target.com/page')
  })
})

describe('parseDuckDuckGoResults', () => {
  it('parses DuckDuckGo HTML results', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage">Example Org</a>
        <a class="result__snippet">This is an example snippet from DDG search.</a>
      </div>
    `
    const results = parseDuckDuckGoResults(html)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Example Org')
    expect(results[0].link).toBe('https://example.org/page')
    expect(results[0].snippet).toContain('This is an example snippet')
  })
})
