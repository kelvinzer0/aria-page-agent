/**
 * Web Search Module (Google Search with Resilient Fallback)
 *
 * Performs real-time web searches using Google Search.
 * Extracts title, destination link (resolving /url?q= redirects), and snippet.
 * Falls back to DuckDuckGo HTML if Google blocks or returns zero results.
 */

export interface SearchResultItem {
  title: string
  link: string
  snippet: string
}

function decodeHTMLEntities(text: string): string {
  const map: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
  }
  let res = text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|hellip);/gi, m => map[m.toLowerCase()] || m)
  res = res.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
  return res
}

/**
 * Extracts organic search results from Google Search HTML.
 */
export function parseGoogleSearchResults(html: string, maxCount = 10): SearchResultItem[] {
  const results: SearchResultItem[] = []
  const seenLinks = new Set<string>()

  // 1. Try DOMParser (fast & standard in browser contexts)
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const anchors = Array.from(doc.querySelectorAll('a[href]'))
      const candidates: Array<{ anchor: Element; link: string; title: string }> = []

      for (const a of anchors) {
        let link = a.getAttribute('href') || ''
        if (link.startsWith('/url?q=')) {
          try {
            const u = new URL(link, 'https://www.google.com')
            link = u.searchParams.get('q') || link
          } catch {}
        }

        if (
          !link.startsWith('http') ||
          link.includes('google.com') ||
          link.includes('google.co.') ||
          link.includes('gstatic.com') ||
          link.includes('youtube.com/channel/')
        ) {
          continue
        }

        const h3 = a.querySelector('h3')
        const title = (h3 ? h3.textContent : a.textContent)?.trim() || ''
        if (!title || title.length < 3 || title.includes('Terjemahkan') || title.includes('Translate')) {
          continue
        }

        if (seenLinks.has(link)) continue
        seenLinks.add(link)
        candidates.push({ anchor: a, link, title })
      }

      for (let i = 0; i < candidates.length && results.length < maxCount; i++) {
        const curr = candidates[i]
        const next = candidates[i + 1]

        // Climb up to the highest parent before the container includes the next candidate
        // Completely independent of any CSS class names
        let container: Element | null = curr.anchor.parentElement
        while (container && container !== doc.body) {
          if (next && container.contains(next.anchor)) {
            break
          }
          if (container.parentElement && next && container.parentElement.contains(next.anchor)) {
            break
          }
          container = container.parentElement
        }

        const rawText = container ? (container.textContent || '') : ''
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
        const candidateLines = lines.filter(l =>
          l !== curr.title &&
          !l.includes('›') &&
          !l.startsWith('http') &&
          !l.includes('Terjemahkan') &&
          !l.includes('Translate') &&
          !l.includes('Hasil Web') &&
          l.length > 20
        )

        const snippet = candidateLines.length > 0
          ? candidateLines.reduce((longest, c) => (c.length > longest.length ? c : longest), '')
          : ''

        results.push({
          title: curr.title,
          link: curr.link,
          snippet: snippet.replace(/\s+/g, ' ').trim(),
        })
      }

      if (results.length > 0) return results
    } catch {
      // Fall through to linear regex/string parser
    }
  }

  // 2. Linear Index Scanner Fallback (works in non-DOM worker environments without regex backtracking)
  let idx = 0
  while (idx < html.length && results.length < maxCount) {
    const h3Start = html.indexOf('<h3', idx)
    if (h3Start === -1) break
    const h3OpenEnd = html.indexOf('>', h3Start)
    if (h3OpenEnd === -1) break
    const h3Close = html.indexOf('</h3>', h3OpenEnd)
    if (h3Close === -1) break

    const title = decodeHTMLEntities(html.slice(h3OpenEnd + 1, h3Close).replace(/<[^>]+>/g, '').trim())

    // Look for preceding <a href="..." before this <h3>
    const aStart = html.lastIndexOf('<a ', h3Start)
    let href = ''
    if (aStart !== -1 && h3Start - aStart < 600) {
      const match = html.slice(aStart, h3OpenEnd).match(/href=["']([^"']+)["']/)
      if (match) href = match[1]
    }

    if (href.startsWith('/url?q=')) {
      try {
        const u = new URL(href, 'https://www.google.com')
        href = u.searchParams.get('q') || href
      } catch {}
    }

    if (
      href.startsWith('http') &&
      !href.includes('google.com') &&
      !href.includes('google.co.') &&
      !href.includes('gstatic.com') &&
      !seenLinks.has(href) &&
      title.length >= 3
    ) {
      seenLinks.add(href)

      const nextH3 = html.indexOf('<h3', h3Close)
      const boundary = nextH3 !== -1 ? nextH3 : Math.min(html.length, h3Close + 1200)
      const rawSnippet = html.slice(h3Close + 5, boundary)

      const snippet = decodeHTMLEntities(
        rawSnippet
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )

      results.push({
        title,
        link: href,
        snippet: snippet.slice(0, 350).trim(),
      })
    }

    idx = h3Close + 5
  }

  return results
}

/**
 * Parses DuckDuckGo HTML search results for fallback redundancy.
 */
export function parseDuckDuckGoResults(html: string, maxCount = 10): SearchResultItem[] {
  const results: SearchResultItem[] = []
  const seenLinks = new Set<string>()

  // Method 1: DOMParser
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const links = doc.querySelectorAll('a.result__a')
      for (const a of Array.from(links)) {
        let href = a.getAttribute('href') || ''
        if (href.includes('uddg=')) {
          try {
            const u = new URL(href, 'https://duckduckgo.com')
            href = decodeURIComponent(u.searchParams.get('uddg') || href)
          } catch {}
        }
        if (!href.startsWith('http') || seenLinks.has(href)) continue
        seenLinks.add(href)

        const title = a.textContent?.trim() || ''
        const parent = a.closest('div.result') || a.parentElement
        const snippetEl = parent?.querySelector('.result__snippet')
        const snippet = snippetEl?.textContent?.trim() || ''

        results.push({ title, link: href, snippet })
        if (results.length >= maxCount) break
      }
      if (results.length > 0) return results
    } catch {}
  }

  // Method 2: Regex scanner
  const regex = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = regex.exec(html)) !== null && results.length < maxCount) {
    let href = m[1]
    if (href.includes('uddg=')) {
      try {
        const u = new URL(href, 'https://duckduckgo.com')
        href = decodeURIComponent(u.searchParams.get('uddg') || href)
      } catch {}
    }
    if (!href.startsWith('http') || seenLinks.has(href)) continue
    seenLinks.add(href)

    const title = decodeHTMLEntities(m[2].replace(/<[^>]+>/g, '').trim())
    const snippet = decodeHTMLEntities(m[3].replace(/<[^>]+>/g, '').trim())
    results.push({ title, link: href, snippet })
  }

  return results
}

/**
 * Searches the web using Google Search as primary with DuckDuckGo fallback.
 */
export async function searchWeb(query: string, count = 10): Promise<SearchResultItem[]> {
  const cleanQuery = (query || '').trim()
  if (!cleanQuery) {
    throw new Error('Search query cannot be empty')
  }

  const requestedCount = Math.max(1, Math.min(count || 10, 30))

  // 1. Primary: Google Search
  try {
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&hl=en&num=${requestedCount}`
    const res = await fetch(googleUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (res.ok) {
      const html = await res.text()
      const googleResults = parseGoogleSearchResults(html, requestedCount)
      if (googleResults.length > 0) {
        return googleResults
      }
    }
  } catch (err) {
    console.warn('[webSearch] Google Search failed or timed out, trying fallback:', err)
  }

  // 2. Fallback: DuckDuckGo HTML
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`
    const res = await fetch(ddgUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (res.ok) {
      const html = await res.text()
      const ddgResults = parseDuckDuckGoResults(html, requestedCount)
      if (ddgResults.length > 0) {
        return ddgResults
      }
    }
  } catch (err) {
    console.warn('[webSearch] Fallback DuckDuckGo also failed:', err)
  }

  return []
}
