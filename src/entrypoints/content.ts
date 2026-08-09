/**
 * Content Script
 *
 * Injected into every page. Handles:
 * - Building AOM from the page DOM
 * - Receiving action commands from the agent
 * - Executing actions on the DOM
 * - Dialog interception
 * - Communicating with background script via messaging
 */

import { traverse, resetTraverse, getAllIssues } from '../aom/traverse'
import { serializeToBrowserState } from '../aom/serializer'
import {
  buildIndexMap,
  clickElement,
  inputText,
  selectOption,
  scroll,
  pressKey,
  hoverElement,
  focusElement,
  toggleCheck,
} from '../executor'

const LOG_PREFIX = '[AriaPageAgent]'

// ─── State ───
let currentRoot: ReturnType<typeof traverse> = null

// ─── Safe sendMessage to background ───
// Uses callback form so chrome.runtime.lastError is always checked,
// suppressing the "Unchecked runtime.lastError" warning in MV3.
function safeSend(msg: object, cb?: (res: any) => void): void {
  try {
    chrome.runtime.sendMessage(msg, (response) => {
      // MUST read lastError to suppress "Unchecked runtime.lastError" warning
      const err = chrome.runtime.lastError
      if (err) {
        // SW is sleeping or not ready — silently ignore
        return
      }
      cb?.(response)
    })
  } catch {
    // Extension context invalidated (page reload during injection) — ignore
  }
}

// ─── Build/Refresh AOM ───
async function refreshAom() {
  resetTraverse()
  currentRoot = traverse(document.body)
  if (!currentRoot) {
    console.error(LOG_PREFIX, 'Failed to build AOM')
    return null
  }
  buildIndexMap(currentRoot)
  const issues = getAllIssues()

  // Get recent dialog events from background (safe — SW may be sleeping)
  const recentDialogs = await new Promise<any[]>((resolve) => {
    safeSend({ type: 'DIALOG_GET_EVENTS', limit: 10 }, (res) => resolve(res || []))
    // Fallback in case SW doesn't respond
    setTimeout(() => resolve([]), 1000)
  })

  return serializeToBrowserState(currentRoot, issues, recentDialogs)
}

// ─── Dialog + Console Interceptor ───
// Listens for postMessage from MAIN world (injected by background).
// Guard uses DOM attribute (shared across all isolated world instances of same page)
// to prevent double-registration if content script loads twice.
function injectDialogInterceptor() {
  // DOM attribute guard — works even if content script loads twice (WXT quirk)
  if (document.documentElement.hasAttribute('data-aria-listener')) return
  document.documentElement.setAttribute('data-aria-listener', '1')

  window.addEventListener('message', (e) => {
    // Forward dialog events to background
    if (e.data?.channel === 'ARIA_PAGE_AGENT_DIALOG') {
      safeSend({
        type: 'DIALOG_EVENT',
        entry: {
          type: e.data.type,
          message: e.data.message,
          timestamp: e.data.timestamp,
          response: e.data.response,
        },
      })
    }

    // Forward console log events to background
    if (e.data?.channel === 'ARIA_PAGE_AGENT_CONSOLE') {
      safeSend({
        type: 'CONSOLE_ENTRY',
        entry: {
          type: e.data.type,
          args: e.data.args,
          timestamp: e.data.timestamp || Date.now(),
          source: e.data.source,
        },
      })
    }

    // Forward network request events to background
    if (e.data?.channel === 'ARIA_NETWORK') {
      safeSend({
        type: 'NETWORK_REQUEST',
        entry: e.data,
      })
    }
  })
}

// ─── Inject MAIN world script via background ───
// Content scripts can't use chrome.tabs, so delegate to background
let mainWorldInjected = false

function injectMainWorldScript() {
  if (mainWorldInjected) return

  safeSend({ type: 'INJECT_DIALOG_INTERCEPTOR' }, (result) => {
    if (result?.success) {
      mainWorldInjected = true
    } else if (result?.error) {
      // Non-critical — page may not need dialog interception
    }
  })
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start', // ← EARLY injection to catch dialogs

  main(_ctx) {
    console.log(LOG_PREFIX, 'Content script loaded on', window.location.href)

    // Inject dialog interceptor IMMEDIATELY (before page code runs)
    injectDialogInterceptor() // postMessage listener

    // Inject MAIN world override (bypasses CSP via chrome.scripting API)
    injectMainWorldScript()

    // Initial AOM build (wait for DOM)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => refreshAom())
    } else {
      refreshAom()
    }

    // Message handler
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type !== 'PAGE_CONTROL') return false

      const { action, payload } = message

      switch (action) {
        case 'get_browser_state': {
          refreshAom()
            .then(state => sendResponse(state || { error: 'Failed to build AOM' }))
            .catch(e => sendResponse({ error: String(e) }))
          return true // async response
        }

        case 'update_tree': {
          refreshAom()
            .then(() => sendResponse({ success: true }))
            .catch(e => sendResponse({ error: String(e) }))
          return true // async response
        }

        case 'click_element': {
          const [index] = payload
          ensureIndexMap()
          clickElement(index).then(sendResponse)
          return true
        }

        case 'input_text': {
          const [index, text] = payload
          ensureIndexMap()
          inputText(index, text).then(sendResponse)
          return true
        }

        case 'select_option': {
          const [index, optionText] = payload
          ensureIndexMap()
          selectOption(index, optionText).then(sendResponse)
          return true
        }

        case 'scroll': {
          ensureIndexMap()
          scroll(payload).then(sendResponse)
          return true
        }

        case 'press_key': {
          const [index, key] = payload
          ensureIndexMap()
          pressKey(index, key).then(sendResponse)
          return true
        }

        case 'hover': {
          const [index] = payload
          ensureIndexMap()
          hoverElement(index).then(sendResponse)
          return true
        }

        case 'focus': {
          const [index] = payload
          ensureIndexMap()
          focusElement(index).then(sendResponse)
          return true
        }

        case 'toggle_check': {
          const [index, value] = payload
          ensureIndexMap()
          toggleCheck(index, value).then(sendResponse)
          return true
        }

        case 'clean_up_highlights': {
          sendResponse({ success: true })
          return false
        }

        default:
          sendResponse({ error: `Unknown action: ${action}` })
          return false
      }
    })
  },
})

function ensureIndexMap() {
  if (!currentRoot) {
    refreshAom()
  }
}
