/**
 * URL Fetching Module with SSRF Protection, MIME Type Handling, Clean Markdown, and Auto-Pagination
 *
 * Safely fetches web resources and adapts its processing based on the response MIME type:
 * - HTML: Converted to clean, structured Markdown (stripping scripts, styles, nav, footer, etc.)
 * - JSON: Pretty-printed inside a json code block
 * - Plain Text & Markdown: Preserved verbatim without HTML tag stripping
 * - CSV & TSV: Converted to clean Markdown tables
 * - XML & RSS/Atom: Formatted inside an xml code block
 * - Images: Returns image metadata and markdown image reference
 * - PDF & Binary: Returns clean file metadata without corrupting LLM context with binary bytes
 *
 * Validates against SSRF on initial URLs and redirect targets.
 * Supports auto-pagination via chunk_index for handling arbitrarily large pages over the MCP bridge.
 */

import { validateUrlSSRF } from './ssrf'
import { htmlToCleanMarkdown } from './htmlToMarkdown'

export interface FetchUrlParams {
  url: string
  chunk_index?: number
  chunk_size?: number
  max_content_length?: number
  raw_html?: boolean
}

export interface FetchUrlResult {
  text: string
  title?: string
  contentType?: string
  totalLength: number
  totalChunks: number
  currentChunk: number
  hasMore: boolean
  isError?: boolean
}

const DEFAULT_CHUNK_SIZE = 8000
const DEFAULT_MAX_CONTENT_LENGTH = 50000
const MAX_REDIRECTS = 5

function formatBytes(bytes: number): string {
  if (isNaN(bytes) || bytes <= 0) return 'unknown size'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * Converts CSV/TSV text into a Markdown table.
 */
function formatCsvToMarkdown(csvText: string, delimiter = ','): string {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length === 0) return ''

  const rows = lines.slice(0, 100).map(line => {
    const cells: string[] = []
    let curr = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === delimiter && !inQuotes) {
        cells.push(curr.trim())
        curr = ''
      } else {
        curr += char
      }
    }
    cells.push(curr.trim())
    return cells
  })

  if (rows.length === 0) return csvText
  const colCount = rows[0].length
  let md = '| ' + rows[0].map(c => c.replace(/\|/g, '\\|')).join(' | ') + ' |\n'
  md += '| ' + Array(colCount).fill('---').join(' | ') + ' |\n'
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    while (row.length < colCount) row.push('')
    md += '| ' + row.slice(0, colCount).map(c => c.replace(/\|/g, '\\|')).join(' | ') + ' |\n'
  }
  if (lines.length > 100) {
    md += `\n*... [Showing first 100 of ${lines.length.toLocaleString()} rows]*\n`
  }
  return md
}

/**
 * Fetches a public web resource safely and returns formatted, paginated content based on MIME type.
 */
export async function fetchUrl(params: FetchUrlParams): Promise<FetchUrlResult> {
  const rawUrl = (params.url || '').trim()
  if (!rawUrl) {
    return {
      text: 'Error: URL parameter is required and cannot be empty.',
      totalLength: 0,
      totalChunks: 0,
      currentChunk: 0,
      hasMore: false,
      isError: true,
    }
  }

  // 1. Initial SSRF check
  const ssrfCheck = validateUrlSSRF(rawUrl)
  if (!ssrfCheck.safe || !ssrfCheck.url) {
    return {
      text: `❌ SSRF Protection Blocked: ${ssrfCheck.error || 'Access to this target is forbidden.'}`,
      totalLength: 0,
      totalChunks: 0,
      currentChunk: 0,
      hasMore: false,
      isError: true,
    }
  }

  let currentUrl = ssrfCheck.url.toString()
  let response: Response | null = null
  let redirectCount = 0

  // 2. Fetch with manual redirect validation to protect against SSRF via redirects
  try {
    while (redirectCount < MAX_REDIRECTS) {
      const res = await fetch(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/json,text/plain,text/markdown;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      })

      // Handle redirects
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) {
          throw new Error(`HTTP ${res.status} redirect without Location header`)
        }

        const nextUrl = new URL(location, currentUrl).toString()
        const nextCheck = validateUrlSSRF(nextUrl)
        if (!nextCheck.safe) {
          return {
            text: `❌ SSRF Protection Blocked Redirect: Cannot redirect to '${nextUrl}'. ${nextCheck.error}`,
            totalLength: 0,
            totalChunks: 0,
            currentChunk: 0,
            hasMore: false,
            isError: true,
          }
        }

        currentUrl = nextUrl
        redirectCount++
        continue
      }

      response = res
      break
    }

    if (!response) {
      throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)
    }

    if (!response.ok) {
      return {
        text: `HTTP Error ${response.status}: ${response.statusText}`,
        totalLength: 0,
        totalChunks: 0,
        currentChunk: 0,
        hasMore: false,
        isError: true,
      }
    }
  } catch (err: any) {
    return {
      text: `Fetch Failed: ${err.message || 'Network error occurred while fetching URL.'}`,
      totalLength: 0,
      totalChunks: 0,
      currentChunk: 0,
      hasMore: false,
      isError: true,
    }
  }

  // 3. Inspect Content-Type MIME type
  const rawContentType = response.headers.get('content-type') || 'text/html'
  const mimeType = rawContentType.split(';')[0].trim().toLowerCase()
  const rawContentLength = parseInt(response.headers.get('content-length') || '0', 10)

  // 4. Handle Binary / Non-Text MIME types early
  if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
    const text = [
      `🖼️ **Image Resource**: ${currentUrl}`,
      `📦 **MIME Type**: ${mimeType}`,
      `📏 **Size**: ${formatBytes(rawContentLength)}`,
      '',
      `![Image](${currentUrl})`,
    ].join('\n')

    return {
      text,
      title: `Image: ${currentUrl}`,
      contentType: mimeType,
      totalLength: text.length,
      totalChunks: 1,
      currentChunk: 0,
      hasMore: false,
    }
  }

  if (mimeType === 'application/pdf') {
    const text = [
      `📄 **PDF Document**: ${currentUrl}`,
      `📦 **MIME Type**: application/pdf`,
      `📏 **Size**: ${formatBytes(rawContentLength)}`,
      '',
      `*(This is a binary PDF document. You can open it in the browser or use an AOM/page snapshot to inspect it if loaded in a tab.)*`,
    ].join('\n')

    return {
      text,
      title: `PDF: ${currentUrl}`,
      contentType: mimeType,
      totalLength: text.length,
      totalChunks: 1,
      currentChunk: 0,
      hasMore: false,
    }
  }

  if (
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/') ||
    mimeType === 'application/zip' ||
    mimeType === 'application/gzip' ||
    mimeType === 'application/x-tar' ||
    mimeType === 'application/octet-stream' ||
    mimeType === 'application/wasm'
  ) {
    const text = [
      `📦 **Binary File**: ${currentUrl}`,
      `📦 **MIME Type**: ${mimeType}`,
      `📏 **Size**: ${formatBytes(rawContentLength)}`,
      '',
      `*(Binary resource cannot be displayed as text.)*`,
    ].join('\n')

    return {
      text,
      title: `Binary: ${currentUrl}`,
      contentType: mimeType,
      totalLength: text.length,
      totalChunks: 1,
      currentChunk: 0,
      hasMore: false,
    }
  }

  // 5. Read Text Content
  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch (err: any) {
    return {
      text: `Failed to read response body: ${err.message}`,
      totalLength: 0,
      totalChunks: 0,
      currentChunk: 0,
      hasMore: false,
      isError: true,
    }
  }

  // 6. Format Content Based on Text MIME Type
  let content = ''
  let title = ''
  let description = ''

  if (params.raw_html) {
    content = bodyText
    title = currentUrl
  } else if (mimeType === 'application/json' || mimeType === 'text/json' || mimeType.endsWith('+json')) {
    // JSON Content
    try {
      const parsed = JSON.parse(bodyText)
      content = '```json\n' + JSON.stringify(parsed, null, 2) + '\n```'
    } catch {
      content = '```json\n' + bodyText.trim() + '\n```'
    }
    title = `JSON: ${currentUrl}`
  } else if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/x-markdown') {
    // Raw Plain Text / Markdown: preserve formatting without HTML tag stripping
    content = bodyText.trim()
    title = `Text: ${currentUrl}`
  } else if (mimeType === 'text/csv' || mimeType === 'text/tab-separated-values') {
    // Tabular CSV / TSV
    const delimiter = mimeType === 'text/tab-separated-values' ? '\t' : ','
    content = formatCsvToMarkdown(bodyText, delimiter)
    title = `Table: ${currentUrl}`
  } else if (mimeType === 'application/xml' || mimeType === 'text/xml' || mimeType.endsWith('+xml')) {
    // XML / RSS / Atom
    content = '```xml\n' + bodyText.trim() + '\n```'
    title = `XML: ${currentUrl}`
  } else {
    // Default HTML / XHTML
    const parsed = htmlToCleanMarkdown(bodyText, currentUrl)
    content = parsed.markdown
    title = parsed.title || currentUrl
    description = parsed.description || ''
  }

  // 7. Apply max_content_length limit
  const maxLen = params.max_content_length && params.max_content_length > 0
    ? params.max_content_length
    : DEFAULT_MAX_CONTENT_LENGTH

  if (content.length > maxLen) {
    content = content.substring(0, maxLen) + '\n\n... [Content truncated at max_content_length limit]'
  }

  // 8. Pagination & Chunking
  const chunkSize = params.chunk_size && params.chunk_size > 500
    ? params.chunk_size
    : DEFAULT_CHUNK_SIZE

  const totalLength = content.length
  const totalChunks = Math.max(1, Math.ceil(totalLength / chunkSize))
  const chunkIndex = Math.max(0, typeof params.chunk_index === 'number' ? params.chunk_index : 0)

  if (chunkIndex >= totalChunks) {
    return {
      text: `⚠️ Chunk ${chunkIndex} is out of bounds. The content only has ${totalChunks} chunks (indices 0 to ${totalChunks - 1}).`,
      totalLength,
      totalChunks,
      currentChunk: chunkIndex,
      hasMore: false,
    }
  }

  const start = chunkIndex * chunkSize
  const end = Math.min(start + chunkSize, totalLength)
  const chunkSlice = content.substring(start, end)
  const hasMore = end < totalLength

  // 9. Format Response with rich pagination headers
  const lines: string[] = []
  lines.push(`📄 **Title**: ${title}`)
  lines.push(`🔗 **URL**: ${currentUrl}`)
  lines.push(`📦 **Content-Type**: ${mimeType}`)
  if (description) {
    lines.push(`📝 **Summary**: ${description}`)
  }

  if (totalChunks > 1) {
    lines.push(
      `📊 **Pagination**: Chunk ${chunkIndex + 1} of ${totalChunks} (Characters ${(start + 1).toLocaleString()} - ${end.toLocaleString()} of ${totalLength.toLocaleString()} total)`
    )
    if (hasMore) {
      lines.push(
        `⏭️ **Next Chunk**: Call \`fetch_url\` with \`url: "${currentUrl}"\` and \`chunk_index: ${chunkIndex + 1}\` to continue.`
      )
    } else {
      lines.push(`🏁 **Status**: Final chunk reached (all content loaded).`)
    }
  }

  lines.push('─'.repeat(50))
  lines.push(chunkSlice)
  lines.push('─'.repeat(50))

  if (hasMore) {
    lines.push(
      `💡 *More content available. Call fetch_url(url="${currentUrl}", chunk_index=${chunkIndex + 1}) to continue reading.*`
    )
  }

  return {
    text: lines.join('\n'),
    title,
    contentType: mimeType,
    totalLength,
    totalChunks,
    currentChunk: chunkIndex,
    hasMore,
  }
}
