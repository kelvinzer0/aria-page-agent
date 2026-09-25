/**
 * HTML to Clean Markdown Converter
 *
 * Converts arbitrary web page HTML into clean, structured Markdown.
 * Strips unnecessary tags (scripts, styles, nav, footer, SVG, etc.)
 * and normalizes whitespace while preserving headings, lists, links,
 * tables, blockquotes, and code blocks.
 */

export interface ParsedPageContent {
  title: string
  description?: string
  markdown: string
  totalLength: number
}

function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&mdash;': '—',
    '&ndash;': '–',
    '&bull;': '•',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&hellip;': '…',
  }

  let res = text.replace(/&(?:nbsp|amp|lt|gt|quot|#39|apos|mdash|ndash|bull|copy|reg|trade|hellip);/gi, m => {
    return entities[m.toLowerCase()] || m
  })

  // Numeric decimal entities &#123;
  res = res.replace(/&#(\d+);/g, (_, num) => {
    const code = parseInt(num, 10)
    return !isNaN(code) && code > 0 ? String.fromCharCode(code) : ''
  })

  // Numeric hex entities &#x7B;
  res = res.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const code = parseInt(hex, 16)
    return !isNaN(code) && code > 0 ? String.fromCharCode(code) : ''
  })

  return res
}

/**
 * Converts an HTML string into structured Markdown.
 */
export function htmlToCleanMarkdown(html: string, baseUrl?: string): ParsedPageContent {
  if (!html || typeof html !== 'string') {
    return { title: '', markdown: '', totalLength: 0 }
  }

  // 1. Extract Title
  let title = ''
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    title = decodeHTMLEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim())
  }
  if (!title) {
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    if (ogTitle) title = decodeHTMLEntities(ogTitle[1].trim())
  }
  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (h1Match) title = decodeHTMLEntities(h1Match[1].replace(/<[^>]+>/g, '').trim())
  }

  // 2. Extract Meta Description
  let description = ''
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  if (descMatch) {
    description = decodeHTMLEntities(descMatch[1].trim())
  }

  // 3. Strip non-content blocks (scripts, styles, comments, SVG, nav, footer, iframes, etc.)
  let content = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
    .replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')

  // 4. Focus on <article> or <main> if present to remove boilerplate
  const mainMatch = content.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
                    content.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
                    content.match(/<div\b[^>]+(?:class|id)=["'][^"']*(?:content|article|post|main|body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
  if (mainMatch && mainMatch[1].length > 500) {
    content = mainMatch[1]
  }

  // 5. Transform Code Blocks `<pre><code>...</code></pre>`
  content = content.replace(/<pre[^>]*>\s*<code(?:\s+class=["'](?:language-)?([a-z0-9_-]+)["'])?[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, lang, code) => {
    const cleanCode = decodeHTMLEntities(code.replace(/<[^>]+>/g, ''))
    return `\n\n\`\`\`${lang || ''}\n${cleanCode.trim()}\n\`\`\`\n\n`
  })

  // Generic <pre>...</pre>
  content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    const cleanCode = decodeHTMLEntities(code.replace(/<[^>]+>/g, ''))
    return `\n\n\`\`\`\n${cleanCode.trim()}\n\`\`\`\n\n`
  })

  // Inline `<code>`
  content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => {
    return ` \`${decodeHTMLEntities(code.replace(/<[^>]+>/g, '')).trim()}\` `
  })

  // 6. Transform Headings
  for (let i = 6; i >= 1; i--) {
    const hRegex = new RegExp(`<h${i}\\b[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi')
    const prefix = '#'.repeat(i)
    content = content.replace(hRegex, (_, text) => {
      const clean = decodeHTMLEntities(text.replace(/<[^>]+>/g, '')).trim()
      return clean ? `\n\n${prefix} ${clean}\n\n` : ''
    })
  }

  // 7. Transform Blockquotes
  content = content.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => {
    const clean = decodeHTMLEntities(text.replace(/<[^>]+>/g, ' ')).trim()
    return clean ? `\n\n> ${clean}\n\n` : ''
  })

  // 8. Transform Lists
  // <li> items
  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => {
    const clean = decodeHTMLEntities(item.replace(/<[^>]+>/g, ' ')).trim()
    return clean ? `\n- ${clean}` : ''
  })
  // close lists with newlines
  content = content.replace(/<\/(?:ul|ol)>/gi, '\n\n')

  // 9. Transform Tables
  content = content.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableHtml) => {
    const rows: string[][] = []
    const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)
    for (const r of rowMatches) {
      const cells: string[] = []
      const cellMatches = r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)
      for (const c of cellMatches) {
        cells.push(decodeHTMLEntities(c[1].replace(/<[^>]+>/g, '')).trim().replace(/\|/g, '\\|'))
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length === 0) return ''

    let mdTable = '\n\n'
    // Header
    mdTable += '| ' + rows[0].join(' | ') + ' |\n'
    mdTable += '| ' + rows[0].map(() => '---').join(' | ') + ' |\n'
    // Rows
    for (let idx = 1; idx < rows.length; idx++) {
      mdTable += '| ' + rows[idx].join(' | ') + ' |\n'
    }
    return mdTable + '\n'
  })

  // 10. Transform Links `<a href="...">...</a>`
  content = content.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const cleanText = decodeHTMLEntities(text.replace(/<[^>]+>/g, '')).trim()
    let fullHref = href.trim()
    if (baseUrl && !fullHref.startsWith('http') && !fullHref.startsWith('#') && !fullHref.startsWith('mailto:')) {
      try {
        fullHref = new URL(fullHref, baseUrl).toString()
      } catch {}
    }
    if (!cleanText) return ''
    if (fullHref.startsWith('javascript:') || fullHref === '#') return cleanText
    return `[${cleanText}](${fullHref})`
  })

  // 11. Transform Images `<img src="..." alt="...">`
  content = content.replace(/<img\b[^>]*>/gi, imgTag => {
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i)
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i)
    const alt = altMatch ? decodeHTMLEntities(altMatch[1].trim()) : ''
    const src = srcMatch ? srcMatch[1].trim() : ''
    if (!src || src.startsWith('data:')) return ''
    return alt ? ` ![${alt}](${src}) ` : ''
  })

  // 12. Transform Paragraphs, Divs, Line breaks
  content = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<\/(?:p|div|section|article|header|h[1-6])>/gi, '\n\n')
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, txt) => `**${decodeHTMLEntities(txt.replace(/<[^>]+>/g, '')).trim()}**`)
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, txt) => `*${decodeHTMLEntities(txt.replace(/<[^>]+>/g, '')).trim()}*`)

  // 13. Strip any remaining HTML tags
  content = content.replace(/<[^>]+>/g, ' ')

  // 14. Decode any remaining HTML entities
  content = decodeHTMLEntities(content)

  // 15. Normalize whitespace (remove lines with only spaces, collapse 3+ newlines to 2)
  const lines = content
    .split('\n')
    .map(line => line.trimEnd())
  
  let cleaned = lines.join('\n')
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ')
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  return {
    title,
    description: description || undefined,
    markdown: cleaned,
    totalLength: cleaned.length,
  }
}
