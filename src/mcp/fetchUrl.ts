/**
 * URL Fetching Module with SSRF Protection, Clean Markdown, and Auto-Pagination
 *
 * Safely fetches public web pages, converts them into readable Markdown,
 * validates against SSRF on both initial and redirected URLs, and provides
 * chunked pagination for handling arbitrarily large content over the MCP bridge.
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
  totalLength: number
  totalChunks: number
  currentChunk: number
  hasMore: boolean
  isError?: boolean
}

const DEFAULT_CHUNK_SIZE = 8000
const DEFAULT_MAX_CONTENT_LENGTH = 50000
const MAX_REDIRECTS = 5

/**
 * Fetches a public web page safely and returns paginated markdown content.
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
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
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

  // 3. Read Body & convert
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

  // 4. Format Conversion (HTML to Markdown vs Raw)
  let content = ''
  let title = ''
  let description = ''

  if (params.raw_html) {
    content = bodyText
    title = currentUrl
  } else {
    const parsed = htmlToCleanMarkdown(bodyText, currentUrl)
    content = parsed.markdown
    title = parsed.title || currentUrl
    description = parsed.description || ''
  }

  // 5. Apply max_content_length limit
  const maxLen = params.max_content_length && params.max_content_length > 0
    ? params.max_content_length
    : DEFAULT_MAX_CONTENT_LENGTH

  if (content.length > maxLen) {
    content = content.substring(0, maxLen) + '\n\n... [Content truncated at max_content_length limit]'
  }

  // 6. Pagination & Chunking
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

  // 7. Format Response with rich pagination headers
  const lines: string[] = []
  lines.push(`📄 **Title**: ${title}`)
  lines.push(`🔗 **URL**: ${currentUrl}`)
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
    totalLength,
    totalChunks,
    currentChunk: chunkIndex,
    hasMore,
  }
}
