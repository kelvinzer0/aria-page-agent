/**
 * Dialog Interceptor
 *
 * Intercepts JavaScript dialogs (alert, confirm, prompt, beforeunload)
 * and makes them visible to the agent.
 *
 * Since native alert() blocks JS execution, we override them BEFORE
 * they're called so we can capture content and optionally auto-dismiss.
 */

export interface DialogEvent {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload' | 'dialog_blocked'
  message: string
  timestamp: number
  response?: string | boolean | null
  autoDismissed?: boolean
}

// ─── Inject dialog interceptor into page ───
export async function injectDialogInterceptor(tabId: number): Promise<{ success: boolean; message: string }> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        // Skip if already injected
        if ((window as any).__ariaDialogInterceptor) return

        const sendDialog = (dialog: any) => {
          window.postMessage({
            channel: 'ARIA_PAGE_AGENT_DIALOG',
            ...dialog,
            timestamp: Date.now(),
          }, '*')
        }

        // Override alert()
        const origAlert = window.alert.bind(window)
        window.alert = function(message?: any) {
          const msg = String(message ?? '')
          sendDialog({ type: 'alert', message: msg })
          // Don't call original - auto-dismiss
        }

        // Override confirm()
        const origConfirm = window.confirm.bind(window)
        window.confirm = function(message?: any) {
          const msg = String(message ?? '')
          sendDialog({ type: 'confirm', message: msg, response: true })
          return true // Auto-accept
        }

        // Override prompt()
        const origPrompt = window.prompt.bind(window)
        window.prompt = function(message?: any, defaultText?: string) {
          const msg = String(message ?? '')
          sendDialog({ type: 'prompt', message: msg, response: defaultText || '' })
          return defaultText || '' // Auto-fill with default
        }

        // Listen for beforeunload
        window.addEventListener('beforeunload', (e) => {
          sendDialog({ type: 'beforeunload', message: e.returnValue || 'Page is navigating away' })
        })

        ;(window as any).__ariaDialogInterceptor = true
      },
    })

    return { success: true, message: '✅ Dialog interceptor injected' }
  } catch (err) {
    return { success: false, message: `❌ Failed to inject dialog interceptor: ${err}` }
  }
}

// ─── Get dialog events from content script ───
let dialogEvents: DialogEvent[] = []
const MAX_DIALOGS = 50

export function addDialogEvent(event: DialogEvent) {
  dialogEvents.push(event)
  if (dialogEvents.length > MAX_DIALOGS) {
    dialogEvents = dialogEvents.slice(-MAX_DIALOGS)
  }
}

export function getDialogEvents(limit = 10): DialogEvent[] {
  return dialogEvents.slice(-limit)
}

export function clearDialogEvents() {
  dialogEvents = []
}

export function hasActiveDialog(): boolean {
  if (dialogEvents.length === 0) return false
  const last = dialogEvents[dialogEvents.length - 1]
  // Consider a dialog "active" if it happened in the last 5 seconds
  return Date.now() - last.timestamp < 5000
}
