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
  const consoleLogs: any[] = []
  const MAX_LOGS = 500
  let dialogEvents: any[] = []
  const MAX_DIALOGS = 50

  // ─── Auto-inject console capture into every tab on load ───
  // Captures: log, warn, error, info, debug + unhandled errors + promise rejections
  const injectConsoleCaptureScript = (tabId: number) => {
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      injectImmediately: false,
      func: () => {
        if ((window as any).__ariaConsoleCapture) return
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
        window.addEventListener('unhandledrejection', e => window.postMessage({ channel: 'ARIA_PAGE_AGENT_CONSOLE', type: 'error', args: [`Unhandled Promise Rejection: ${e.reason}`], timestamp: Date.now(), source: location.href }, '*'))
        ;(window as any).__ariaConsoleCapture = true
      },
    }).catch(() => {/* non-injectable tabs like chrome:// */})
  }

  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'complete') injectConsoleCaptureScript(tabId)
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

    // ─── Dialog events from content script ───
    if (message.type === 'DIALOG_EVENT') {
      dialogEvents.push(message.entry)
      if (dialogEvents.length > MAX_DIALOGS) {
        dialogEvents.splice(0, dialogEvents.length - MAX_DIALOGS)
      }
      return false
    }

    // ─── Inject dialog interceptor into MAIN world ───
    if (message.type === 'INJECT_DIALOG_INTERCEPTOR') {
      const senderTabId = sender.tab?.id
      if (!senderTabId) {
        sendResponse({ success: false, error: 'No tab ID' })
        return false
      }

      chrome.scripting.executeScript({
        target: { tabId: senderTabId },
        world: 'MAIN',
        injectImmediately: true,
        func: () => {
          if ((window as any).__ariaDialogInterceptor) return

          const sendDialog = (dialog: any) => {
            window.postMessage({
              channel: 'ARIA_PAGE_AGENT_DIALOG',
              ...dialog,
              timestamp: Date.now(),
            }, '*')
          }

          window.alert = function(message?: any) {
            sendDialog({ type: 'alert', message: String(message ?? '') })
          }

          window.confirm = function(message?: any) {
            sendDialog({ type: 'confirm', message: String(message ?? ''), response: true })
            return true
          }

          window.prompt = function(message?: any, defaultText?: string) {
            const msg = String(message ?? '')
            sendDialog({ type: 'prompt', message: msg, response: defaultText || '' })
            return defaultText || ''
          }

          window.addEventListener('beforeunload', (e) => {
            sendDialog({ type: 'beforeunload', message: e.returnValue || 'Page navigating away' })
          })

          ;(window as any).__ariaDialogInterceptor = true
        },
      }).then(() => {
        sendResponse({ success: true })
      }).catch((err: Error) => {
        sendResponse({ success: false, error: err.message })
      })

      return true // async response
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
