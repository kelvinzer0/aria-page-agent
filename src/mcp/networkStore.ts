/**
 * Network Request Store
 * Captures fetch, XHR, and resource requests from intercepted page.
 * Persists across page navigations while bridge is active.
 */

export type NetworkResourceType =
  | 'fetch' | 'xhr'
  | 'document' | 'script' | 'stylesheet'
  | 'font' | 'image' | 'media'
  | 'manifest' | 'websocket' | 'wasm' | 'other'

export interface NetworkEntry {
  id: string
  url: string
  method: string
  type: NetworkResourceType
  status?: number
  statusText?: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  size?: number          // bytes
  duration?: number      // ms
  startTime: number      // Date.now()
  endTime?: number
  error?: string
  tabId?: number
  tabUrl?: string
}

const MAX_ENTRIES = 1000
let entries: NetworkEntry[] = []

export function pushNetworkEntry(entry: NetworkEntry): void {
  // Replace if same ID already exists (update with response)
  const idx = entries.findIndex(e => e.id === entry.id)
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...entry }
  } else {
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

export function getNetworkEntries(options?: {
  filter?: string
  limit?: number
  tabId?: number
}): NetworkEntry[] {
  let result = [...entries]

  // Tab filter
  if (options?.tabId) {
    result = result.filter(e => e.tabId === options.tabId)
  }

  // Type filter
  if (options?.filter && options.filter !== 'all') {
    const f = options.filter.toLowerCase()
    result = result.filter(e => {
      switch (f) {
        case 'fetch':    return e.type === 'fetch'
        case 'xhr':      return e.type === 'xhr'
        case 'fetch/xhr':return e.type === 'fetch' || e.type === 'xhr'
        case 'document': return e.type === 'document'
        case 'css':      return e.type === 'stylesheet'
        case 'js':       return e.type === 'script'
        case 'font':     return e.type === 'font'
        case 'img':      return e.type === 'image'
        case 'media':    return e.type === 'media'
        case 'manifest': return e.type === 'manifest'
        case 'websocket':return e.type === 'websocket'
        case 'socket':   return e.type === 'websocket'
        case 'wasm':     return e.type === 'wasm'
        case 'other':    return e.type === 'other'
        default:         return true
      }
    })
  }

  if (options?.limit) result = result.slice(-options.limit)
  return result
}

export function getNetworkEntryById(id: string): NetworkEntry | undefined {
  return entries.find(e => e.id === id)
}

export function clearNetworkEntries(): void {
  entries = []
}

/** Map PerformanceResourceTiming initiatorType → NetworkResourceType */
export function mapInitiatorType(initiatorType: string, url: string): NetworkResourceType {
  switch (initiatorType) {
    case 'fetch':           return 'fetch'
    case 'xmlhttprequest':  return 'xhr'
    case 'navigation':      return 'document'
    case 'script':          return 'script'
    case 'link':            return url.endsWith('.css') || url.includes('.css?') ? 'stylesheet' : 'other'
    case 'css':             return 'stylesheet'
    case 'img':             return 'image'
    case 'image':           return 'image'
    case 'audio':
    case 'video':
    case 'media':           return 'media'
    case 'font':            return 'font'
    case 'use':             return 'other'
    default:
      if (url.endsWith('.wasm')) return 'wasm'
      if (url.includes('manifest')) return 'manifest'
      if (/\.(woff2?|ttf|otf|eot)/.test(url)) return 'font'
      if (/\.(mp4|webm|ogg|mp3|wav)/.test(url)) return 'media'
      if (/\.(png|jpg|jpeg|gif|svg|webp|ico|avif)/.test(url)) return 'image'
      return 'other'
  }
}
