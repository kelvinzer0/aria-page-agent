/**
 * MCP Tool Definitions & Execution
 *
 * Maps AOM/executor capabilities to MCP tool definitions.
 * executeToolViaBackground runs INSIDE the background service worker,
 * so it must call Chrome APIs directly — NOT via chrome.runtime.sendMessage.
 */

import type { ToolDefinition, ToolResult } from './bridge'
import {
  listTabs,
  switchToTab,
  openNewTab,
  closeTab,
  reloadTab,
} from '../agent/tabs'
import { getStoredConsoleLogs } from './consoleStore'
import { getNetworkEntries, getNetworkEntryById, clearNetworkEntries } from './networkStore'
import { isUrlInScope } from './scopeMatcher'

// ─── Tool Definitions ───

export function getToolDefinitions(): ToolDefinition[] {
  return [
    // Page inspection
    {
      name: 'page_snapshot',
      description: 'Capture the full Accessibility Object Model (AOM) of the current page. Returns semantic tree with ARIA roles, accessible names, interactive element indices, and page structure. Use this FIRST before any interaction.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'page_url',
      description: 'Get current page URL and title',
      inputSchema: { type: 'object', properties: {} },
    },

    // Element interaction (by AOM index)
    {
      name: 'click',
      description: 'Click an element by its AOM interactive index (from page_snapshot)',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Interactive element index from page_snapshot [N]' },
        },
        required: ['index'],
      },
    },
    {
      name: 'type_text',
      description: 'Type text into an input field by its AOM interactive index',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Interactive element index' },
          text: { type: 'string', description: 'Text to type' },
        },
        required: ['index', 'text'],
      },
    },
    {
      name: 'select_option',
      description: 'Select an option in a dropdown/combobox by AOM index',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Interactive element index' },
          option_text: { type: 'string', description: 'Option text to select (partial match)' },
        },
        required: ['index', 'option_text'],
      },
    },
    {
      name: 'toggle_check',
      description: 'Check or uncheck a checkbox/radio by AOM index',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Interactive element index' },
          value: { type: 'boolean', description: 'true=check, false=uncheck, omit=toggle' },
        },
        required: ['index'],
      },
    },
    {
      name: 'press_key',
      description: 'Press a keyboard key. If index provided, press on that element. Otherwise press on focused element.',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Interactive element index (omit for focused element)' },
          key: { type: 'string', description: 'Key to press (Enter, Escape, Tab, ArrowDown, etc.)' },
        },
        required: ['key'],
      },
    },
    {
      name: 'hover',
      description: 'Hover over an element by AOM index (triggers mouseenter/mouseover)',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Interactive element index' },
        },
        required: ['index'],
      },
    },
    {
      name: 'focus',
      description: 'Focus an element by AOM index',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Interactive element index' },
        },
        required: ['index'],
      },
    },

    // Scrolling
    {
      name: 'scroll',
      description: 'Scroll the page or a specific element',
      inputSchema: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
          amount: { type: 'number', description: 'Pixels to scroll' },
          pages: { type: 'number', description: 'Number of viewport pages to scroll' },
          target_index: { type: 'number', description: 'AOM index of element to scroll within (omit for page)' },
        },
        required: ['direction'],
      },
    },

    // Tab management
    {
      name: 'list_tabs',
      description: 'List all open browser tabs with their IDs, titles, and URLs',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'switch_tab',
      description: 'Switch to a different browser tab',
      inputSchema: {
        type: 'object',
        properties: {
          tab_id: { type: 'number', description: 'Tab ID to switch to' },
        },
        required: ['tab_id'],
      },
    },
    {
      name: 'new_tab',
      description: 'Open a new browser tab',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open (omit for blank tab)' },
        },
      },
    },
    {
      name: 'close_tab',
      description: 'Close a browser tab',
      inputSchema: {
        type: 'object',
        properties: {
          tab_id: { type: 'number', description: 'Tab ID to close' },
        },
        required: ['tab_id'],
      },
    },
    {
      name: 'navigate',
      description: 'Navigate current tab to a URL and wait for it to fully load',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
          wait_ms: { type: 'number', description: 'Extra ms to wait after page load for JS rendering (default: 1500, max: 10000)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'go_back',
      description: 'Go back in browser history',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'go_forward',
      description: 'Go forward in browser history',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'reload',
      description: 'Reload the current page',
      inputSchema: { type: 'object', properties: {} },
    },

    // Debug tools
    {
      name: 'get_console_logs',
      description: 'Get recent console logs from the page',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of log entries (default: 20)' },
          level: { type: 'string', enum: ['log', 'warn', 'error', 'info', 'debug'], description: 'Filter by level' },
        },
      },
    },
    {
      name: 'execute_script',
      description: 'Execute JavaScript in the page context',
      inputSchema: {
        type: 'object',
        properties: {
          script: { type: 'string', description: 'JavaScript code to execute' },
        },
        required: ['script'],
      },
    },
    {
      name: 'get_accessibility_summary',
      description: 'Get accessibility audit summary of the page',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'network_monitor',
      description: 'Monitor network requests on the current page. Auto-captures fetch, XHR, and all resource types. History persists while bridge is active.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'detail', 'clear'],
            description: 'list=show requests, detail=full request+response for one entry, clear=reset history',
          },
          filter: {
            type: 'string',
            enum: ['all', 'fetch', 'xhr', 'fetch/xhr', 'document', 'css', 'js', 'font', 'img', 'media', 'manifest', 'websocket', 'wasm', 'other'],
            description: 'Filter by resource type (default: all)',
          },
          request_id: {
            type: 'string',
            description: 'Request ID to inspect (required for action=detail)',
          },
          limit: {
            type: 'number',
            description: 'Max entries to return (default: 30)',
          },
          chunk_index: {
            type: 'number',
            description: 'For detail view: which chunk of the body to return (0-indexed). Use to read large response bodies.',
          },
          chunk_size: {
            type: 'number',
            description: 'For detail view: size of each chunk in characters (default: 10000)',
          }
        },
        required: ['action'],
      },
    },
  ]
}

// ─── Tool Execution ───
// This function runs INSIDE the background service worker.
// Use Chrome APIs directly — never chrome.runtime.sendMessage to self.

export async function executeToolViaBackground(
  name: string,
  params: Record<string, unknown>
): Promise<ToolResult> {

  // ── Helper: get the active tab in the last focused window ──
  // (service workers have no "currentWindow", so use lastFocusedWindow)
  const getTab = async (): Promise<chrome.tabs.Tab> => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.id) throw new Error('No active tab found')
    return tab
  }

  // ── Helper: send a PAGE_CONTROL message to the content script in a tab ──
  const pageControl = async (tabId: number, action: string, payload?: any): Promise<any> => {
    return chrome.tabs.sendMessage(tabId, { type: 'PAGE_CONTROL', action, payload })
  }

  switch (name) {

    // ─── Page Inspection ───────────────────────────────────────

    case 'page_url': {
      const tab = await getTab()
      return ok(`${tab.url}\n${tab.title}`)
    }

    case 'page_snapshot': {
      const tab = await getTab()
      const state = await pageControl(tab.id!, 'get_browser_state')
      if (state?.error) return err(state.error)
      return ok(JSON.stringify(state, null, 2))
    }

    case 'get_accessibility_summary': {
      const tab = await getTab()
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: () => {
          const issues: string[] = []
          document.querySelectorAll('img').forEach(img => {
            if (!img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation')
              issues.push(`❌ <img src="${img.src?.substring(0, 50)}"> missing alt`)
          })
          document.querySelectorAll('button, a[href]').forEach(el => {
            const name = el.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('title')
            if (!name) issues.push(`❌ <${el.tagName.toLowerCase()}> has no accessible name`)
          })
          document.querySelectorAll('input, select, textarea').forEach(el => {
            const id = el.id
            const hasLabel = id && document.querySelector(`label[for="${id}"]`)
            const hasAriaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
            const inLabel = el.closest('label')
            if (!hasLabel && !hasAriaLabel && !inLabel && (el as HTMLInputElement).type !== 'hidden')
              issues.push(`❌ <${el.tagName.toLowerCase()}> has no associated label`)
          })
          return issues.length > 0 ? issues.join('\n') : '✅ No obvious accessibility issues found'
        },
      })
      return ok(String(results?.[0]?.result ?? 'No result'))
    }

    // ─── Element Interaction (via content script) ──────────────

    case 'click': {
      const tab = await getTab()
      const res = await pageControl(tab.id!, 'click_element', [params.index])
      return resultFromResponse(res)
    }

    case 'type_text': {
      const tab = await getTab()
      const res = await pageControl(tab.id!, 'input_text', [params.index, params.text])
      return resultFromResponse(res)
    }

    case 'select_option': {
      const tab = await getTab()
      const res = await pageControl(tab.id!, 'select_option', [params.index, params.option_text])
      return resultFromResponse(res)
    }

    case 'toggle_check': {
      const tab = await getTab()
      const res = await pageControl(tab.id!, 'toggle_check', [params.index, params.value])
      return resultFromResponse(res)
    }

    case 'press_key': {
      const tab = await getTab()
      const res = await pageControl(tab.id!, 'press_key', [params.index ?? null, params.key])
      return resultFromResponse(res)
    }

    case 'hover': {
      const tab = await getTab()
      const res = await pageControl(tab.id!, 'hover', [params.index])
      return resultFromResponse(res)
    }

    case 'focus': {
      const tab = await getTab()
      const res = await pageControl(tab.id!, 'focus', [params.index])
      return resultFromResponse(res)
    }

    case 'scroll': {
      const tab = await getTab()
      const res = await pageControl(tab.id!, 'scroll', {
        direction: params.direction,
        amount: params.amount,
        pages: params.pages,
        targetIndex: params.target_index,
      })
      return resultFromResponse(res)
    }

    // ─── Tab Management (direct Chrome API) ───────────────────

    case 'list_tabs': {
      const tabs = await listTabs()
      const list = tabs.map(t => `[${t.id}] ${t.title} — ${t.url}`).join('\n')
      return ok(list || 'No tabs found')
    }

    case 'switch_tab': {
      const res = await switchToTab(params.tab_id as number)
      return resultFromResponse(res)
    }

    case 'new_tab': {
      const res = await openNewTab(params.url as string)
      return resultFromResponse(res)
    }

    case 'close_tab': {
      const res = await closeTab(params.tab_id as number)
      return resultFromResponse(res)
    }

    case 'navigate': {
      const tab = await getTab()
      const extraWait = Math.min((params.wait_ms as number) || 1500, 10000)
      await chrome.tabs.update(tab.id!, { url: params.url as string })
      const updated = await waitForTabLoad(tab.id!, 10000)
      await new Promise(r => setTimeout(r, extraWait))
      return ok(`✅ Navigated to: "${updated.title}" (${updated.url})`)
    }

    case 'go_back': {
      const tab = await getTab()
      await chrome.tabs.goBack(tab.id!)
      const updated = await waitForTabLoad(tab.id!, 8000)
      await new Promise(r => setTimeout(r, 1000))
      return ok(`✅ Went back to: "${updated.title}" (${updated.url})`)
    }

    case 'go_forward': {
      const tab = await getTab()
      await chrome.tabs.goForward(tab.id!)
      const updated = await waitForTabLoad(tab.id!, 8000)
      await new Promise(r => setTimeout(r, 1000))
      return ok(`✅ Went forward to: "${updated.title}" (${updated.url})`)
    }

    case 'reload': {
      const tab = await getTab()
      await chrome.tabs.reload(tab.id!)
      const updated = await waitForTabLoad(tab.id!, 10000)
      await new Promise(r => setTimeout(r, 1000))
      return ok(`✅ Reloaded: "${updated.title}" (${updated.url})`)
    }

    // ─── Debug Tools ──────────────────────────────────────────

    case 'get_console_logs': {
      const logs = getStoredConsoleLogs({
        limit: (params.limit as number) || 20,
        type: params.level as string,
      })
      if (!logs.length) return ok('No console logs captured yet. Logs are captured automatically after the next page load.')
      return ok(logs.map(l => `[${l.type.toUpperCase()}] ${l.args?.join(' ')}`).join('\n'))
    }

    case 'execute_script': {
      const tab = await getTab()
      const code = params.script as string
      const SCRIPT_TIMEOUT = 30000

      // ═══════════════════════════════════════════════════════════════
      // ISOLATED + MAIN RPC Pattern (Recommended)
      // ═══════════════════════════════════════════════════════════════
      // ISOLATED world: no page CSP, can eval() freely
      // MAIN world: has page CSP, only predefined functions
      // Communication: postMessage bridge
      //
      // Flow:
      // 1. ISOLATED eval(code) → gets result
      // 2. ISOLATED posts result to MAIN via postMessage
      // 3. MAIN forwards result back to ISOLATED
      // ═══════════════════════════════════════════════════════════════
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          world: 'ISOLATED',
          injectImmediately: true,
          func: (code: string, timeout: number) => {
            // This runs in ISOLATED world — no page CSP
            return new Promise<any>((resolve) => {
              const ch = '__ariaRPC_' + Date.now()
              const timer = setTimeout(() => resolve({ success: false, error: 'RPC timeout' }), timeout)

              // Listen for result from MAIN world
              const handler = (e: MessageEvent) => {
                if (e.data?.channel === ch && e.data?.__ariaRPC) {
                  window.removeEventListener('message', handler)
                  clearTimeout(timer)
                  resolve(e.data)
                }
              }
              window.addEventListener('message', handler)

              // Execute code in ISOLATED world (eval is allowed here)
              try {
                const asyncCode = `(async () => { ${code} })()`
                const evalResult = eval(asyncCode)

                if (evalResult && typeof evalResult.then === 'function') {
                  evalResult.then(
                    (r: any) => {
                      window.postMessage({ channel: ch, __ariaRPC: true, success: true, result: r }, '*')
                    },
                    (e: any) => {
                      window.postMessage({ channel: ch, __ariaRPC: true, success: false, error: e.message || String(e) }, '*')
                    }
                  )
                } else {
                  window.postMessage({ channel: ch, __ariaRPC: true, success: true, result: evalResult }, '*')
                }
              } catch (evalErr: any) {
                window.removeEventListener('message', handler)
                clearTimeout(timer)
                resolve({ success: false, error: evalErr.message || String(evalErr) })
              }
            })
          },
          args: [code, SCRIPT_TIMEOUT],
        })
        const result = results?.[0]?.result
        if (result?.success) return ok(JSON.stringify(result.result, null, 2))
        return err(result?.error || 'Script execution failed')
      } catch (e: any) {
        return err(`Script execution failed: ${e.message}`)
      }
    }

    case 'network_monitor': {
      const action = (params.action as string) || 'list'

      if (action === 'clear') {
        clearNetworkEntries()
        return ok('✅ Network history cleared.')
      }

      if (action === 'detail') {
        const id = params.request_id as string
        if (!id) return err('request_id is required for action=detail')
        const entry = getNetworkEntryById(id)
        if (!entry) return err(`No request found with id: ${id}`)
        
        const storageResult = await chrome.storage.local.get(['scopeConfig'])
        const scopeStr = storageResult.scopeConfig || ''
        const scopeLabel = isUrlInScope(entry.url, scopeStr) ? '[SCOPE_IN]' : '[SCOPE_OUT]'
        
        const chunkIndex = typeof params.chunk_index === 'number' ? params.chunk_index : 0
        const chunkSize = typeof params.chunk_size === 'number' ? params.chunk_size : 10000
        const start = chunkIndex * chunkSize
        const end = start + chunkSize
        
        const formatBody = (body?: string, label = 'Body') => {
          if (!body) return `  (no ${label.toLowerCase()} captured)`
          const totalChunks = Math.ceil(body.length / chunkSize)
          if (start >= body.length) return `  (chunk ${chunkIndex} out of bounds, total chunks: ${totalChunks})`
          const slice = body.substring(start, end)
          const info = body.length > chunkSize ? ` (chunk ${chunkIndex + 1} of ${totalChunks})` : ''
          return `── ${label}${info} ──\n${slice}`
        }

        const lines: string[] = [
          `🔵 ${scopeLabel} ${entry.method} ${entry.url}`,
          `Type: ${entry.type} | Status: ${entry.status ?? 'pending'}${entry.statusText ? ' ' + entry.statusText : ''} | Duration: ${entry.duration != null ? entry.duration + 'ms' : 'pending'} | Size: ${entry.size != null ? formatBytes(entry.size) : '?'}`,
          `Time: ${new Date(entry.startTime).toLocaleTimeString()}`,
          entry.error ? `❌ Error: ${entry.error}` : '',
          '',
          '── Request Headers ──',
          entry.requestHeaders && Object.keys(entry.requestHeaders).length ? Object.entries(entry.requestHeaders).map(([k,v]) => `  ${k}: ${v}`).join('\n') : '  (none)',
          '',
          formatBody(entry.requestBody, 'Request Body'),
          '',
          '── Response Headers ──',
          entry.responseHeaders && Object.keys(entry.responseHeaders).length ? Object.entries(entry.responseHeaders).map(([k,v]) => `  ${k}: ${v}`).join('\n') : '  (none)',
          '',
          formatBody(entry.responseBody, 'Response Body'),
        ].filter(l => l !== '')
        return ok(lines.join('\n'))
      }

      // action === 'list'
      const entries = getNetworkEntries({
        filter: params.filter as string,
        limit: (params.limit as number) || 30,
      })
      if (!entries.length) {
        return ok('No network requests captured yet.\nNetwork monitoring starts automatically on next page load after bridge connects.\nTip: reload the page or navigate somewhere to start capturing.')
      }

      const storageResult = await chrome.storage.local.get(['scopeConfig'])
      const scopeStr = storageResult.scopeConfig || ''

      const lines = entries.map(e => {
        const status = e.status != null ? e.status : e.error ? 'ERR' : '...'
        const dur = e.duration != null ? e.duration + 'ms' : '?ms'
        const size = e.size != null ? formatBytes(e.size) : '?'
        const icon = e.error ? '❌' : e.status && e.status >= 400 ? '🟡' : '✅'
        const scopeLabel = isUrlInScope(e.url, scopeStr) ? '[SCOPE_IN]' : '[SCOPE_OUT]'
        const shortUrl = e.url.length > 80 ? e.url.substring(0, 77) + '...' : e.url
        return `${icon} [${e.id.substring(0, 8)}] ${scopeLabel} ${e.method} ${status} ${dur} ${size} [${e.type}] ${shortUrl}`
      })
      const total = getNetworkEntries({ filter: params.filter as string }).length
      lines.unshift(`Network Requests (${entries.length}/${total} shown | filter: ${params.filter || 'all'})`)
      lines.unshift('ID       Scope      Method Status  Dur    Size   Type       URL')
      lines.unshift('─'.repeat(100))
      return ok(lines.join('\n'))
    }

    default:
      return err(`Unknown tool: ${name}`)
  }
}

// ─── Helpers ───

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

function err(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function resultFromResponse(res: any): ToolResult {
  if (!res) return err('No response from content script')
  if (res?.error) return err(res.error)
  if (res?.success === false) return err(res.message || 'Action failed')
  return ok(typeof res?.message === 'string' ? res.message : JSON.stringify(res))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

// Wait for a tab to finish loading (status === 'complete')
// Uses onUpdated listener for efficiency, falls back to polling on timeout
function waitForTabLoad(tabId: number, timeoutMs = 10000): Promise<chrome.tabs.Tab> {
  return new Promise((resolve) => {
    let resolved = false

    const finish = async () => {
      if (resolved) return
      resolved = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      const tab = await chrome.tabs.get(tabId).catch(() => ({ id: tabId } as chrome.tabs.Tab))
      resolve(tab)
    }

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') finish()
    }

    chrome.tabs.onUpdated.addListener(listener)

    // Fallback: if already complete or timeout fires
    const timer = setTimeout(finish, timeoutMs)

    // Check immediately in case tab is already complete
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') finish()
    }).catch(() => {})
  })
}
