/**
 * Background Service Worker
 *
 * Handles:
 * - Extension icon click → open side panel
 * - Message routing between side panel and content scripts
 * - Tab management operations
 * - Debug tools coordination
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
  const dialogEvents: any[] = []
  const MAX_DIALOGS = 50

  // Message handler
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    // ─── Console entry from content script ───
    if (message.type === 'CONSOLE_ENTRY') {
      consoleLogs.push(message.entry)
      if (consoleLogs.length > MAX_LOGS) {
        consoleLogs.splice(0, consoleLogs.length - MAX_LOGS)
      }
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
