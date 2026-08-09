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
import {
  getConsoleLogs,
} from '../agent/debug'

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
      description: 'Navigate current tab to a URL',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
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
      await chrome.tabs.update(tab.id!, { url: params.url as string })
      await new Promise(r => setTimeout(r, 2000))
      const updated = await chrome.tabs.get(tab.id!)
      return ok(`✅ Navigated to: "${updated.title}" (${updated.url})`)
    }

    case 'go_back': {
      const tab = await getTab()
      await chrome.tabs.goBack(tab.id!)
      await new Promise(r => setTimeout(r, 1000))
      const updated = await chrome.tabs.get(tab.id!)
      return ok(`✅ Went back to: "${updated.title}" (${updated.url})`)
    }

    case 'go_forward': {
      const tab = await getTab()
      await chrome.tabs.goForward(tab.id!)
      await new Promise(r => setTimeout(r, 1000))
      const updated = await chrome.tabs.get(tab.id!)
      return ok(`✅ Went forward to: "${updated.title}" (${updated.url})`)
    }

    case 'reload': {
      const tab = await getTab()
      const res = await reloadTab(tab.id!)
      return resultFromResponse(res)
    }

    // ─── Debug Tools ──────────────────────────────────────────

    case 'get_console_logs': {
      const logs = await getConsoleLogs({
        limit: params.limit as number || 20,
        type: params.level as string,
      })
      if (!logs?.length) return ok('No console logs captured yet.')
      return ok(logs.map((l: any) => `[${l.type}] ${l.args?.join(' ')}`).join('\n'))
    }

    case 'execute_script': {
      const tab = await getTab()
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          world: 'MAIN',
          injectImmediately: true,
          func: (code: string) => {
            return new Promise<any>((resolve) => {
              const channel = '__ariaEval_' + Date.now()
              const handler = (e: MessageEvent) => {
                if (e.data?.channel === channel) {
                  window.removeEventListener('message', handler)
                  resolve(e.data)
                }
              }
              window.addEventListener('message', handler)
              setTimeout(() => { window.removeEventListener('message', handler); resolve({ success: false, error: 'Timeout' }) }, 10000)
              const scriptEl = document.createElement('script')
              scriptEl.textContent = `(async function(){try{const r=await eval(${JSON.stringify(code)});window.postMessage({channel:'${channel}',success:true,result:r},'*')}catch(e){window.postMessage({channel:'${channel}',success:false,error:e.message},'*')}})()`
              document.documentElement.appendChild(scriptEl); scriptEl.remove()
            })
          },
          args: [params.script as string],
        })
        const result = results?.[0]?.result
        if (result?.success) return ok(JSON.stringify(result.result, null, 2))
        return err(result?.error || 'Script execution failed')
      } catch (e: any) {
        return err(e.message)
      }
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
