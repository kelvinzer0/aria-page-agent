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

  // Get recent dialog events from background
  const recentDialogs = await chrome.runtime.sendMessage({
    type: 'DIALOG_GET_EVENTS',
    limit: 10,
  }).catch(() => [])

  return serializeToBrowserState(currentRoot, issues, recentDialogs)
}

// ─── Dialog Interceptor ───
// Injected EARLY (document_start) to catch dialogs before page code runs
function injectDialogInterceptor() {
  // Already injected by the MAIN world script injection below
  // This is a backup: listen for postMessage from page context
  window.addEventListener('message', (e) => {
    if (e.data?.channel === 'ARIA_PAGE_AGENT_DIALOG') {
      chrome.runtime.sendMessage({
        type: 'DIALOG_EVENT',
        entry: {
          type: e.data.type,
          message: e.data.message,
          timestamp: e.data.timestamp,
          response: e.data.response,
        },
      }).catch(() => {})
    }
  })
}

// ─── Inject MAIN world script via background ───
// Content scripts can't use chrome.tabs, so delegate to background
let mainWorldInjected = false

async function injectMainWorldScript() {
  if (mainWorldInjected) return
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'INJECT_DIALOG_INTERCEPTOR',
    })
    
    if (result?.success) {
      mainWorldInjected = true
    } else {
      console.warn(LOG_PREFIX, 'Dialog injection failed:', result?.error)
    }
  } catch (err) {
    console.warn(LOG_PREFIX, 'Failed to request dialog injection:', err)
  }
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
