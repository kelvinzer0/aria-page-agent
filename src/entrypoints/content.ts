/**
 * Content Script
 *
 * Injected into every page. Handles:
 * - Building AOM from the page DOM
 * - Receiving action commands from the agent
 * - Executing actions on the DOM
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
function refreshAom() {
  resetTraverse()
  currentRoot = traverse(document.body)
  if (!currentRoot) {
    console.error(LOG_PREFIX, 'Failed to build AOM')
    return null
  }
  buildIndexMap(currentRoot)
  const issues = getAllIssues()
  return serializeToBrowserState(currentRoot, issues)
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',

  main(_ctx) {
    console.log(LOG_PREFIX, 'Content script loaded on', window.location.href)

    // Initial AOM build
    refreshAom()

    // Message handler
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type !== 'PAGE_CONTROL') return false

      const { action, payload } = message

      switch (action) {
        case 'get_browser_state': {
          try {
            const state = refreshAom()
            sendResponse(state || { error: 'Failed to build AOM' })
          } catch (e) {
            sendResponse({ error: String(e) })
          }
          return false
        }

        case 'update_tree': {
          try {
            refreshAom()
            sendResponse({ success: true })
          } catch (e) {
            sendResponse({ error: String(e) })
          }
          return false
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
