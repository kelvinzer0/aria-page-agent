/**
 * Tab Controller
 *
 * Manages browser tabs for the agent:
 * - List all tabs
 * - Get current tab info
 * - Switch to tab
 * - Open new tab
 * - Close tab
 * - Navigate current tab to URL
 * - Go back/forward
 * - Reload tab
 */

export interface TabInfo {
  id: number
  url: string
  title: string
  active: boolean
  index: number
  windowId: number
  status?: string
  favIconUrl?: string
}

// ─── List all tabs ───
export async function listTabs(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({})
  return tabs.map(t => ({
    id: t.id!,
    url: t.url || '',
    title: t.title || '',
    active: t.active,
    index: t.index,
    windowId: t.windowId,
    status: t.status,
    favIconUrl: t.favIconUrl,
  }))
}

// ─── Get current tab ───
export async function getCurrentTab(): Promise<TabInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id) return null
  return {
    id: tab.id,
    url: tab.url || '',
    title: tab.title || '',
    active: tab.active,
    index: tab.index,
    windowId: tab.windowId,
    status: tab.status,
    favIconUrl: tab.favIconUrl,
  }
}

// ─── Switch to tab ───
export async function switchToTab(tabId: number): Promise<{ success: boolean; message: string }> {
  try {
    await chrome.tabs.update(tabId, { active: true })
    const tab = await chrome.tabs.get(tabId)
    return { success: true, message: `✅ Switched to tab: "${tab.title}" (${tab.url})` }
  } catch (err) {
    return { success: false, message: `❌ Failed to switch to tab ${tabId}: ${err}` }
  }
}

// ─── Open new tab ───
export async function openNewTab(url: string): Promise<{ success: boolean; message: string; tabId?: number }> {
  try {
    const tab = await chrome.tabs.create({ url, active: true })
    // Wait for tab to start loading
    await new Promise(r => setTimeout(r, 1000))
    return {
      success: true,
      message: `✅ Opened new tab: "${tab.title || url}" (id: ${tab.id})`,
      tabId: tab.id!,
    }
  } catch (err) {
    return { success: false, message: `❌ Failed to open tab: ${err}` }
  }
}

// ─── Close tab ───
export async function closeTab(tabId: number): Promise<{ success: boolean; message: string }> {
  try {
    const tab = await chrome.tabs.get(tabId)
    const title = tab.title || tab.url
    await chrome.tabs.remove(tabId)
    return { success: true, message: `✅ Closed tab: "${title}"` }
  } catch (err) {
    return { success: false, message: `❌ Failed to close tab ${tabId}: ${err}` }
  }
}

// ─── Navigate to URL ───
export async function navigateTo(url: number | string): Promise<{ success: boolean; message: string }> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.id) return { success: false, message: 'No active tab' }

    await chrome.tabs.update(tab.id, { url: typeof url === 'string' ? url : undefined })
    // Wait for navigation
    await new Promise(r => setTimeout(r, 2000))
    const updated = await chrome.tabs.get(tab.id)
    return { success: true, message: `✅ Navigated to: "${updated.title}" (${updated.url})` }
  } catch (err) {
    return { success: false, message: `❌ Failed to navigate: ${err}` }
  }
}

// ─── Go back ───
export async function goBack(): Promise<{ success: boolean; message: string }> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.id) return { success: false, message: 'No active tab' }

    await chrome.tabs.goBack(tab.id)
    await new Promise(r => setTimeout(r, 1000))
    const updated = await chrome.tabs.get(tab.id)
    return { success: true, message: `✅ Went back to: "${updated.title}" (${updated.url})` }
  } catch (err) {
    return { success: false, message: `❌ Failed to go back: ${err}` }
  }
}

// ─── Go forward ───
export async function goForward(): Promise<{ success: boolean; message: string }> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.id) return { success: false, message: 'No active tab' }

    await chrome.tabs.goForward(tab.id)
    await new Promise(r => setTimeout(r, 1000))
    const updated = await chrome.tabs.get(tab.id)
    return { success: true, message: `✅ Went forward to: "${updated.title}" (${updated.url})` }
  } catch (err) {
    return { success: false, message: `❌ Failed to go forward: ${err}` }
  }
}

// ─── Reload tab ───
export async function reloadTab(tabId?: number): Promise<{ success: boolean; message: string }> {
  try {
    const targetTabId = tabId || (await getCurrentTab())?.id
    if (!targetTabId) return { success: false, message: 'No active tab' }

    await chrome.tabs.reload(targetTabId)
    await new Promise(r => setTimeout(r, 1500))
    const tab = await chrome.tabs.get(targetTabId)
    return { success: true, message: `✅ Reloaded tab: "${tab.title}" (${tab.url})` }
  } catch (err) {
    return { success: false, message: `❌ Failed to reload: ${err}` }
  }
}

// ─── Duplicate tab ───
export async function duplicateTab(tabId: number): Promise<{ success: boolean; message: string; newTabId?: number }> {
  try {
    const newTab = await chrome.tabs.duplicate(tabId)
    return {
      success: true,
      message: `✅ Duplicated tab: "${newTab?.title}" (id: ${newTab?.id})`,
      newTabId: newTab?.id,
    }
  } catch (err) {
    return { success: false, message: `❌ Failed to duplicate tab: ${err}` }
  }
}
