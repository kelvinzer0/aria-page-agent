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

// ─── Inject MAIN world script via script tag ───
// This is more reliable than chrome.scripting.executeScript for MAIN world
function injectMainWorldScript() {
  const script = document.createElement('script')
  script.textContent = `
    (function() {
      if (window.__ariaDialogInterceptor) return;
      
      const sendDialog = (dialog) => {
        window.postMessage({
          channel: 'ARIA_PAGE_AGENT_DIALOG',
          ...dialog,
          timestamp: Date.now(),
        }, '*');
      };
      
      // Override alert
      const origAlert = window.alert;
      window.alert = function(message) {
        const msg = String(message ?? '');
        sendDialog({ type: 'alert', message: msg });
        // Don't call original - auto-dismiss
      };
      
      // Override confirm
      const origConfirm = window.confirm;
      window.confirm = function(message) {
        const msg = String(message ?? '');
        sendDialog({ type: 'confirm', message: msg, response: true });
        return true; // Auto-accept
      };
      
      // Override prompt
      const origPrompt = window.prompt;
      window.prompt = function(message, defaultText) {
        const msg = String(message ?? '');
        sendDialog({ type: 'prompt', message: msg, response: defaultText || '' });
        return defaultText || '';
      };
      
      // Listen for beforeunload
      window.addEventListener('beforeunload', function(e) {
        sendDialog({ type: 'beforeunload', message: e.returnValue || 'Page navigating away' });
      });
      
      window.__ariaDialogInterceptor = true;
      console.log('[AriaPageAgent] Dialog interceptor injected (MAIN world)');
    })();
  `;
  ;(document.head || document.documentElement).appendChild(script)
  script.remove() // Clean up DOM, code already executed
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start', // ← EARLY injection to catch dialogs

  main(_ctx) {
    console.log(LOG_PREFIX, 'Content script loaded on', window.location.href)

    // Inject dialog interceptor IMMEDIATELY (before page code runs)
    injectDialogInterceptor() // postMessage listener
    injectMainWorldScript()   // Override alert/confirm/prompt in MAIN world

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
