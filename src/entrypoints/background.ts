/**
 * Background Service Worker
 *
 * Handles:
 * - Extension icon click → open side panel
 * - Message routing between side panel and content scripts
 * - Tab management operations
 * - Debug tools coordination
 * - MCP Bridge integration (start/stop, custom URL)
 */

import {
  listTabs,
  getCurrentTab,
  switchToTab,
  openNewTab,
  closeTab,
  navigateTo,
  goBack,
  goForward,
  reloadTab,
  duplicateTab,
} from '../agent/tabs'

import {
  startConsoleCapture,
  getConsoleLogs,
  clearConsoleLogs,
  executeScript,
  getPageErrors,
  getComputedStyles,
  getAccessibilitySummary,
  getPerformanceMetrics,
} from '../agent/debug'

import { MCPBridgeClient, type BridgeConfig } from '../mcp/bridge'
import { getToolDefinitions, executeToolViaBackground } from '../mcp/tools'
import { pushConsoleLog } from '../mcp/consoleStore'
import { pushNetworkEntry, mapInitiatorType } from '../mcp/networkStore'

// ─── MCP Bridge Instance ───
let bridge: MCPBridgeClient | null = null

// ─── Load saved config ───
async function loadBridgeConfig(): Promise<BridgeConfig> {
  const result = await chrome.storage.local.get(['bridgeUrl', 'bridgeRoom'])
  return {
    url: result.bridgeUrl || '',
    room: result.bridgeRoom || '',
  }
}

async function saveBridgeConfig(config: BridgeConfig): Promise<void> {
  await chrome.storage.local.set({
    bridgeUrl: config.url,
    bridgeRoom: config.room || '',
  })
}

// ─── Start Bridge ───
async function startBridge(url: string): Promise<{ success: boolean; room?: string; mcpUrl?: string; error?: string }> {
  if (bridge?.isConnected()) {
    bridge.disconnect()
  }

  // Load saved room to persist it across restarts
  const saved = await loadBridgeConfig()
  const config: BridgeConfig = {
    url: url.replace(/\/+$/, ''),
    room: saved.room || undefined,   // ← reuse saved room, empty string → undefined
  }
  await saveBridgeConfig(config)

  bridge = new MCPBridgeClient(config)

  // Register tool call handler
  bridge.setToolCallHandler(executeToolViaBackground)

  // Register tools when connected
  bridge.onStatusChange((status, room) => {
    console.log('[AriaPageAgent] Bridge status:', status, 'room:', room)

    if (status === 'connected' && bridge) {
      // Register all tools
      bridge.registerTools(getToolDefinitions())

      // Update badge
      chrome.action.setBadgeText({ text: '🟢' })
      chrome.action.setBadgeBackgroundColor({ color: '#44ff44' })

      // Save room
      saveBridgeConfig({ url: config.url, room })
    }

    if (status === 'disconnected') {
      chrome.action.setBadgeText({ text: '' })
    }
  })

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, error: 'Connection timeout' })
    }, 10000)

    bridge!.onStatusChange((status, room) => {
      if (status === 'connected') {
        clearTimeout(timeout)
        resolve({
          success: true,
          room,
          mcpUrl: bridge?.getMcpUrl(),
        })
      }
    })

    bridge!.connect()
  })
}

// ─── Stop Bridge ───
function stopBridge(): void {
  if (bridge) {
    bridge.disconnect()
    bridge = null
  }
  chrome.action.setBadgeText({ text: '' })
}

// ─── Get Bridge Status ───
function getBridgeStatus(): { connected: boolean; room?: string; mcpUrl?: string; url?: string } {
  if (!bridge) {
    return { connected: false }
  }
  return {
    connected: bridge.isConnected(),
    room: bridge.getRoom(),
    mcpUrl: bridge.getMcpUrl(),
  }
}

// ─── Background Script ───

export default defineBackground(() => {
  // Open side panel on icon click
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id })
    }
  })

  // Console log collection from content scripts
  // (unused local array — shared store in consoleStore.ts is the source of truth)
  let dialogEvents: any[] = []
  const MAX_DIALOGS = 50

  // ─── Auto-inject console capture + dialog interceptor on every tab load ───
  // Single combined inject eliminates duplicate log entries.
  // Guard flag __ariaPageAgentReady prevents double-injection on revisit.
  const injectMainWorldScripts = (tabId: number) => {
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      injectImmediately: false,
      func: () => {
        // Stable flag — never rename this across extension versions
        if ((window as any).__ariaPageAgent) return
        ;(window as any).__ariaPageAgent = true
        // Clear old flags from previous extension versions
        delete (window as any).__ariaConsoleCapture
        delete (window as any).__ariaDialogInterceptor
        delete (window as any).__ariaPageAgentReady

        // ── Console capture (all 5 levels + errors + rejections) ──
        const orig: Record<string, any> = {}
        ;['log','warn','error','info','debug'].forEach(t => {
          orig[t] = (console as any)[t].bind(console)
          ;(console as any)[t] = (...args: any[]) => {
            orig[t](...args)
            window.postMessage({
              channel: 'ARIA_PAGE_AGENT_CONSOLE',
              type: t,
              args: args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch { return String(a) } }),
              timestamp: Date.now(),
              source: location.href,
            }, '*')
          }
        })
        window.addEventListener('error', e => window.postMessage({ channel: 'ARIA_PAGE_AGENT_CONSOLE', type: 'error', args: [`${e.message} @ ${e.filename}:${e.lineno}`], timestamp: Date.now(), source: location.href }, '*'))
        window.addEventListener('unhandledrejection', e => window.postMessage({ channel: 'ARIA_PAGE_AGENT_CONSOLE', type: 'error', args: [`Unhandled Promise Rejection: ${String(e.reason)}`], timestamp: Date.now(), source: location.href }, '*'))

        // ── Network Monitor: fetch + XHR interceptor + PerformanceObserver ──
        const _origFetch = window.fetch
        window.fetch = async function(...args: any[]) {
          const id = Math.random().toString(36).slice(2, 10)
          const start = Date.now()
          let reqUrl = ''
          let reqMethod = 'GET'
          let reqHeaders: Record<string,string> = {}
          let reqBody = ''
          try {
            const req = args[0] instanceof Request ? args[0] : new Request(args[0] as RequestInfo, args[1] as RequestInit)
            reqUrl = req.url
            reqMethod = req.method
            req.headers.forEach((v:string, k:string) => reqHeaders[k] = v)
            reqBody = await req.clone().text().catch(() => '') as string
            if (reqBody.length > 5000) reqBody = reqBody.substring(0, 5000) + '...[truncated]'
          } catch {}
          try {
            const res = await _origFetch.apply(this, args)
            const resClone = res.clone()
            const ct = res.headers.get('content-type') || ''
            const resHeaders: Record<string,string> = {}
            res.headers.forEach((v:string, k:string) => resHeaders[k] = v)
            let resBody = ''
            if (ct.includes('json') || ct.includes('text') || ct.includes('xml')) {
              resBody = await resClone.text().catch(() => '') as string
              if (resBody.length > 50000) resBody = resBody.substring(0, 50000) + '\n...[truncated]'
            }
            const size = parseInt(res.headers.get('content-length') || '0') || resBody.length
            window.postMessage({ channel: 'ARIA_NETWORK', id, url: reqUrl || res.url, method: reqMethod, type: 'fetch', status: res.status, statusText: res.statusText, requestHeaders: reqHeaders, responseHeaders: resHeaders, requestBody: reqBody, responseBody: resBody, size, duration: Date.now()-start, startTime: start, endTime: Date.now() }, '*')
            return res
          } catch(e: any) {
            window.postMessage({ channel: 'ARIA_NETWORK', id, url: reqUrl, method: reqMethod, type: 'fetch', error: e.message, duration: Date.now()-start, startTime: start, endTime: Date.now() }, '*')
            throw e
          }
        }

        // XHR interceptor
        const _origXHR = window.XMLHttpRequest
        function PatchedXHR(this: any) {
          const xhr = new _origXHR()
          const id = Math.random().toString(36).slice(2, 10)
          const start = Date.now()
          let method = 'GET'
          let url = ''
          const reqHeaders: Record<string,string> = {}
          let reqBody = ''
          const origOpen = xhr.open.bind(xhr)
          xhr.open = function(m: string, u: string, ...rest: any[]) { method = m; url = u; return origOpen(m, u, ...rest) }
          const origSetHeader = xhr.setRequestHeader.bind(xhr)
          xhr.setRequestHeader = function(k: string, v: string) { reqHeaders[k] = v; return origSetHeader(k, v) }
          const origSend = xhr.send.bind(xhr)
          xhr.send = function(body?: any) {
            if (body) { try { reqBody = typeof body === 'string' ? body.substring(0, 5000) : JSON.stringify(body).substring(0, 5000) } catch {} }
            xhr.addEventListener('load', () => {
              const ct = xhr.getResponseHeader('content-type') || ''
              let resBody = ''
              if (ct.includes('json') || ct.includes('text') || ct.includes('xml')) { try { resBody = (xhr.responseText || '').substring(0, 50000) } catch {} }
              const resHeaders: Record<string,string> = {}
              try { xhr.getAllResponseHeaders().split('\r\n').forEach((h: string) => { const [k,...v] = h.split(': '); if(k) resHeaders[k.toLowerCase()] = v.join(': ') }) } catch {}
              window.postMessage({ channel: 'ARIA_NETWORK', id, url, method, type: 'xhr', status: xhr.status, statusText: xhr.statusText, requestHeaders: reqHeaders, responseHeaders: resHeaders, requestBody: reqBody, responseBody: resBody, size: resBody.length || xhr.response?.byteLength || 0, duration: Date.now()-start, startTime: start, endTime: Date.now() }, '*')
            })
            xhr.addEventListener('error', () => window.postMessage({ channel: 'ARIA_NETWORK', id, url, method, type: 'xhr', error: 'XHR Error', duration: Date.now()-start, startTime: start, endTime: Date.now() }, '*'))
            return origSend(body)
          }
          return xhr
        }
        PatchedXHR.prototype = _origXHR.prototype
        ;(window as any).XMLHttpRequest = PatchedXHR

        // PerformanceObserver for CSS/JS/img/font/media/document etc.
        try {
          const po = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const e = entry as PerformanceResourceTiming
              if (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') continue // already captured
              window.postMessage({ channel: 'ARIA_NETWORK', id: Math.random().toString(36).slice(2,10), url: e.name, method: 'GET', initiatorType: e.initiatorType, size: e.transferSize || e.decodedBodySize, duration: Math.round(e.duration), startTime: Date.now() - Math.round(e.duration), endTime: Date.now() }, '*')
            }
          })
          po.observe({ type: 'resource', buffered: true })
        } catch {}

        const sendDialog = (d: any) => window.postMessage({ channel: 'ARIA_PAGE_AGENT_DIALOG', ...d, timestamp: Date.now() }, '*')
        window.alert = (m?: any) => sendDialog({ type: 'alert', message: String(m ?? '') })
        window.confirm = (m?: any) => { sendDialog({ type: 'confirm', message: String(m ?? ''), response: true }); return true }
        window.prompt = (m?: any, def?: string) => { sendDialog({ type: 'prompt', message: String(m ?? ''), response: def || '' }); return def || '' }
        window.addEventListener('beforeunload', e => sendDialog({ type: 'beforeunload', message: e.returnValue || 'Page navigating away' }))
      },
    }).catch(() => {/* non-injectable tabs like chrome:// */})
  }

  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'complete') injectMainWorldScripts(tabId)
  })

  // Auto-start bridge if URL was saved
  loadBridgeConfig().then((config) => {
    if (config.url) {
      startBridge(config.url).catch((err) => {
        console.warn('[AriaPageAgent] Auto-start bridge failed:', err)
      })
    }
  })

  // Message handler
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // ─── MCP Bridge Control ───
    if (message.type === 'BRIDGE_START') {
      startBridge(message.url).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'BRIDGE_STOP') {
      stopBridge()
      sendResponse({ success: true })
      return false
    }

    if (message.type === 'BRIDGE_STATUS') {
      sendResponse(getBridgeStatus())
      return false
    }

    // Reset room: clears saved room so next connect creates a new one
    if (message.type === 'BRIDGE_RESET_ROOM') {
      stopBridge()
      if (bridge) bridge.resetRoom()
      chrome.storage.local.remove(['bridgeRoom']).then(() => {
        sendResponse({ success: true })
      })
      return true
    }

    // ─── PAGE_CONTROL messages (route to content script) ───
    if (message.type === 'PAGE_CONTROL' && message.targetTabId) {
      chrome.tabs.sendMessage(message.targetTabId, message)
        .then(sendResponse)
        .catch((error: Error) => {
          console.error('[Background] Failed to route message:', error)
          sendResponse({ error: error.message })
        })
      return true
    }

    // ─── Console entry from content script → shared store ───
    if (message.type === 'CONSOLE_ENTRY') {
      pushConsoleLog(message.entry)
      return false
    }

    // ─── Network request from content script → network store ───
    if (message.type === 'NETWORK_REQUEST') {
      const entry = message.entry
      // Map initiatorType for performance entries (non-fetch/xhr)
      if (!entry.type && entry.initiatorType) {
        entry.type = mapInitiatorType(entry.initiatorType, entry.url || '')
      }
      pushNetworkEntry(entry)
      return false
    }

    // ─── Dialog events from content script ───
    if (message.type === 'DIALOG_EVENT') {
      dialogEvents.push(message.entry)
      if (dialogEvents.length > MAX_DIALOGS) {
        dialogEvents.splice(0, dialogEvents.length - MAX_DIALOGS)
      }
      return false
    }

    // ─── Inject MAIN world scripts (console + dialog) ───
    // Now handled automatically by tabs.onUpdated above.
    // This handler is kept for backward compat with content.ts calling it on document_start.
    if (message.type === 'INJECT_DIALOG_INTERCEPTOR') {
      const senderTabId = sender.tab?.id
      if (!senderTabId) {
        sendResponse({ success: false, error: 'No tab ID' })
        return false
      }
      // Trigger same combined inject (guard prevents double-run)
      injectMainWorldScripts(senderTabId)
      sendResponse({ success: true })
      return false
    }

    // ─── Get dialog events ───
    if (message.type === 'DIALOG_GET_EVENTS') {
      sendResponse(dialogEvents.slice(-(message.limit || 10)))
      return false
    }

    if (message.type === 'DIALOG_CLEAR') {
      dialogEvents = []
      sendResponse({ success: true })
      return false
    }

    // ─── Tab Management ───
    if (message.type === 'TAB_LIST') {
      listTabs().then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_CURRENT') {
      getCurrentTab().then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_SWITCH') {
      switchToTab(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_OPEN') {
      openNewTab(message.url).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_CLOSE') {
      closeTab(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_NAVIGATE') {
      navigateTo(message.url).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_BACK') {
      goBack().then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_FORWARD') {
      goForward().then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_RELOAD') {
      reloadTab(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'TAB_DUPLICATE') {
      duplicateTab(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    // ─── Debug Tools ───
    if (message.type === 'DEBUG_START_CAPTURE') {
      startConsoleCapture(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'DEBUG_GET_LOGS') {
      const logs = getConsoleLogs(message.options)
      sendResponse(logs)
      return false
    }

    if (message.type === 'DEBUG_CLEAR_LOGS') {
      clearConsoleLogs()
      sendResponse({ success: true })
      return false
    }

    if (message.type === 'DEBUG_EXECUTE_SCRIPT') {
      executeScript(message.tabId, message.script).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'DEBUG_GET_ERRORS') {
      getPageErrors(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'DEBUG_GET_STYLES') {
      getComputedStyles(message.tabId, message.selector).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'DEBUG_ACCESSIBILITY') {
      getAccessibilitySummary(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'DEBUG_PERFORMANCE') {
      getPerformanceMetrics(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    // ─── Legacy support ───
    if (message.type === 'GET_ACTIVE_TAB') {
      getCurrentTab().then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'LIST_TABS') {
      listTabs().then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    if (message.type === 'SWITCH_TAB') {
      switchToTab(message.tabId).then(sendResponse).catch(e => sendResponse({ error: e.message }))
      return true
    }

    return false
  })

  console.log('[AriaPageAgent] Background service worker loaded')
})
