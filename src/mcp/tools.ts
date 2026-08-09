/**
 * MCP Tool Definitions
 *
 * Maps AOM/executor capabilities to MCP tool definitions.
 * Each tool calls into the content script via background message routing.
 */

import type { ToolDefinition, ToolResult } from './bridge'

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

export async function executeToolViaBackground(
  name: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  const send = (msg: any): Promise<any> =>
    chrome.runtime.sendMessage(msg)

  switch (name) {
    case 'page_snapshot': {
      const tab = await getActiveTab()
      const state = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'get_browser_state',
      })
      if (state?.error) return err(state.error)
      return ok(JSON.stringify(state, null, 2))
    }

    case 'page_url': {
      const tab = await getActiveTab()
      return ok(`${tab.url}\n${tab.title}`)
    }

    case 'click': {
      const tab = await getActiveTab()
      const res = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'click_element',
        payload: [params.index],
      })
      return resultFromResponse(res)
    }

    case 'type_text': {
      const tab = await getActiveTab()
      const res = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'input_text',
        payload: [params.index, params.text],
      })
      return resultFromResponse(res)
    }

    case 'select_option': {
      const tab = await getActiveTab()
      const res = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'select_option',
        payload: [params.index, params.option_text],
      })
      return resultFromResponse(res)
    }

    case 'toggle_check': {
      const tab = await getActiveTab()
      const res = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'toggle_check',
        payload: [params.index, params.value],
      })
      return resultFromResponse(res)
    }

    case 'press_key': {
      const tab = await getActiveTab()
      const res = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'press_key',
        payload: [params.index ?? null, params.key],
      })
      return resultFromResponse(res)
    }

    case 'hover': {
      const tab = await getActiveTab()
      const res = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'hover',
        payload: [params.index],
      })
      return resultFromResponse(res)
    }

    case 'focus': {
      const tab = await getActiveTab()
      const res = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'focus',
        payload: [params.index],
      })
      return resultFromResponse(res)
    }

    case 'scroll': {
      const tab = await getActiveTab()
      const res = await send({
        type: 'PAGE_CONTROL',
        targetTabId: tab.id,
        action: 'scroll',
        payload: {
          direction: params.direction,
          amount: params.amount,
          pages: params.pages,
          targetIndex: params.target_index,
        },
      })
      return resultFromResponse(res)
    }

    case 'list_tabs': {
      const tabs = await send({ type: 'TAB_LIST' })
      if (tabs?.error) return err(tabs.error)
      const list = tabs.map((t: any) => `[${t.id}] ${t.title} — ${t.url}`).join('\n')
      return ok(list)
    }

    case 'switch_tab': {
      const res = await send({ type: 'TAB_SWITCH', tabId: params.tab_id })
      return resultFromResponse(res)
    }

    case 'new_tab': {
      const res = await send({ type: 'TAB_OPEN', url: params.url as string })
      return resultFromResponse(res)
    }

    case 'close_tab': {
      const res = await send({ type: 'TAB_CLOSE', tabId: params.tab_id })
      return resultFromResponse(res)
    }

    case 'navigate': {
      const tab = await getActiveTab()
      const res = await send({ type: 'TAB_NAVIGATE', url: params.url })
      return resultFromResponse(res)
    }

    case 'go_back': {
      const res = await send({ type: 'TAB_BACK' })
      return resultFromResponse(res)
    }

    case 'go_forward': {
      const res = await send({ type: 'TAB_FORWARD' })
      return resultFromResponse(res)
    }

    case 'reload': {
      const tab = await getActiveTab()
      const res = await send({ type: 'TAB_RELOAD', tabId: tab.id })
      return resultFromResponse(res)
    }

    case 'get_console_logs': {
      const logs = await send({
        type: 'DEBUG_GET_LOGS',
        options: { limit: params.limit || 20, level: params.level },
      })
      if (!logs?.length) return ok('No console logs captured. Use DEBUG_START_CAPTURE first.')
      return ok(logs.map((l: any) => `[${l.level}] ${l.message}`).join('\n'))
    }

    case 'execute_script': {
      const tab = await getActiveTab()
      const res = await send({ type: 'DEBUG_EXECUTE_SCRIPT', tabId: tab.id, script: params.script })
      return resultFromResponse(res)
    }

    case 'get_accessibility_summary': {
      const tab = await getActiveTab()
      const res = await send({ type: 'DEBUG_ACCESSIBILITY', tabId: tab.id })
      return ok(JSON.stringify(res, null, 2))
    }

    default:
      return err(`Unknown tool: ${name}`)
  }
}

// ─── Helpers ───

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  // Use lastFocusedWindow:true — service workers don't have a "currentWindow"
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) throw new Error('No active tab found')
  return tab
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

function err(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function resultFromResponse(res: any): ToolResult {
  if (res?.error) return err(res.error)
  if (res?.success === false) return err(res.message || 'Action failed')
  return ok(typeof res?.message === 'string' ? res.message : JSON.stringify(res))
}
