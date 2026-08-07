/**
 * Background Service Worker
 *
 * Handles:
 * - Extension icon click → open side panel
 * - Message routing between side panel and content scripts
 * - Tab management
 */

// ─── Open side panel on icon click ───
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id })
  }
})

// ─── Message routing ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Route PAGE_CONTROL messages from side panel to content script
  if (message.type === 'PAGE_CONTROL' && message.targetTabId) {
    chrome.tabs.sendMessage(message.targetTabId, message)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Background] Failed to route message:', error)
        sendResponse({ error: error.message })
      })
    return true // async
  }

  // Get active tab info
  if (message.type === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => {
        sendResponse({ id: tab?.id, url: tab?.url, title: tab?.title })
      })
      .catch((error) => {
        sendResponse({ error: error.message })
      })
    return true
  }

  // List all tabs
  if (message.type === 'LIST_TABS') {
    chrome.tabs.query({})
      .then((tabs) => {
        sendResponse(tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active })))
      })
      .catch((error) => {
        sendResponse({ error: error.message })
      })
    return true
  }

  // Switch to tab
  if (message.type === 'SWITCH_TAB' && message.tabId) {
    chrome.tabs.update(message.tabId, { active: true })
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ error: error.message }))
    return true
  }

  return false
})

console.log('[AriaPageAgent] Background service worker loaded')
