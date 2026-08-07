/**
 * Console & Debug Tools
 *
 * Tools for the agent to debug web pages:
 * - Capture console logs
 * - Execute JavaScript
 * - Get page errors
 * - Monitor network requests
 * - Get element computed styles
 * - Screenshot page
 */

export interface ConsoleEntry {
  type: 'log' | 'warn' | 'error' | 'info' | 'debug'
  args: string[]
  timestamp: number
  source?: string
}

export interface NetworkEntry {
  method: string
  url: string
  status?: number
  statusText?: string
  type?: string
  timestamp: number
  duration?: number
}

// ─── Console log capture state ───
let consoleLogs: ConsoleEntry[] = []
let networkLogs: NetworkEntry[] = []
const MAX_LOGS = 200

// ─── Inject console capture into page ───
export async function startConsoleCapture(tabId: number): Promise<{ success: boolean; message: string }> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Store original methods
        const origConsole = {
          log: console.log.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console),
          info: console.info.bind(console),
          debug: console.debug.bind(console),
        }

        // Override console methods
        const captureConsole = (type: string) => (...args: any[]) => {
          // Call original
          ;(origConsole as any)[type](...args)

          // Send to extension
          window.postMessage({
            channel: 'ARIA_PAGE_AGENT_CONSOLE',
            type,
            args: args.map(a => {
              try {
                return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
              } catch {
                return String(a)
              }
            }),
            timestamp: Date.now(),
            source: location.href,
          }, '*')
        }

        console.log = captureConsole('log')
        console.warn = captureConsole('warn')
        console.error = captureConsole('error')
        console.info = captureConsole('info')
        console.debug = captureConsole('debug')

        // Capture unhandled errors
        window.addEventListener('error', (e) => {
          window.postMessage({
            channel: 'ARIA_PAGE_AGENT_CONSOLE',
            type: 'error',
            args: [`${e.message} at ${e.filename}:${e.lineno}:${e.colno}`],
            timestamp: Date.now(),
            source: location.href,
          }, '*')
        })

        // Capture unhandled promise rejections
        window.addEventListener('unhandledrejection', (e) => {
          window.postMessage({
            channel: 'ARIA_PAGE_AGENT_CONSOLE',
            type: 'error',
            args: [`Unhandled Promise Rejection: ${e.reason}`],
            timestamp: Date.now(),
            source: location.href,
          }, '*')
        })

        // Mark as captured
        ;(window as any).__ariaPageAgentConsoleCaptured = true
        origConsole.log('[AriaPageAgent] Console capture started')
      },
    })

    // Listen for console messages from content script
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'CONSOLE_ENTRY') {
        consoleLogs.push(message.entry)
        if (consoleLogs.length > MAX_LOGS) {
          consoleLogs = consoleLogs.slice(-MAX_LOGS)
        }
      }
    })

    return { success: true, message: '✅ Console capture started. Logs will be collected.' }
  } catch (err) {
    return { success: false, message: `❌ Failed to start console capture: ${err}` }
  }
}

// ─── Get captured console logs ───
export async function getConsoleLogs(options?: {
  type?: string
  limit?: number
  since?: number
}): Promise<ConsoleEntry[]> {
  let logs = [...consoleLogs]

  if (options?.type) {
    logs = logs.filter(l => l.type === options.type)
  }

  if (options?.since) {
    logs = logs.filter(l => l.timestamp >= options.since!)
  }

  if (options?.limit) {
    logs = logs.slice(-options.limit)
  }

  return logs
}

// ─── Clear console logs ───
export function clearConsoleLogs(): void {
  consoleLogs = []
}

// ─── Execute JavaScript in page ───
export async function executeScript(
  tabId: number,
  script: string
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (code: string) => {
        try {
          // Wrap in async function to support await
          const asyncFn = new Function(`return (async () => { ${code} })()`)
          return { success: true, result: asyncFn() }
        } catch (err: any) {
          return { success: false, error: err.message }
        }
      },
      args: [script],
    })

    const result = results?.[0]?.result
    if (result?.success) {
      // Handle promise results
      const value = result.result instanceof Promise ? await result.result : result.result
      return { success: true, result: value }
    } else {
      return { success: false, error: result?.error || 'Unknown error' }
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ─── Get page errors ───
export async function getPageErrors(tabId: number): Promise<string[]> {
  const errors = consoleLogs.filter(l => l.type === 'error')
  return errors.map(l => l.args.join(' '))
}

// ─── Get element computed styles ───
export async function getComputedStyles(
  tabId: number,
  selector: string
): Promise<{ success: boolean; styles?: Record<string, string>; error?: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel: string) => {
        const el = document.querySelector(sel)
        if (!el) return { success: false, error: `Element not found: ${sel}` }

        const computed = getComputedStyle(el)
        const styles: Record<string, string> = {}

        // Get commonly useful styles
        const importantProps = [
          'display', 'visibility', 'opacity', 'position', 'z-index',
          'width', 'height', 'margin', 'padding', 'border',
          'background', 'color', 'font-size', 'font-weight',
          'overflow', 'cursor', 'pointer-events',
        ]

        for (const prop of importantProps) {
          styles[prop] = computed.getPropertyValue(prop)
        }

        return { success: true, styles }
      },
      args: [selector],
    })

    return results?.[0]?.result || { success: false, error: 'No result' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ─── Get accessibility tree summary ───
export async function getAccessibilitySummary(
  tabId: number
): Promise<{ success: boolean; summary?: string; error?: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const issues: string[] = []

        // Check images without alt
        document.querySelectorAll('img').forEach(img => {
          if (!img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation') {
            issues.push(`❌ <img src="${img.src?.substring(0, 50)}"> missing alt`)
          }
        })

        // Check buttons/links without accessible name
        document.querySelectorAll('button, a[href]').forEach(el => {
          const name = el.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('title')
          if (!name) {
            issues.push(`❌ <${el.tagName.toLowerCase()}> has no accessible name`)
          }
        })

        // Check form inputs without labels
        document.querySelectorAll('input, select, textarea').forEach(el => {
          const id = el.id
          const hasLabel = id && document.querySelector(`label[for="${id}"]`)
          const hasAriaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
          const inLabel = el.closest('label')

          if (!hasLabel && !hasAriaLabel && !inLabel && (el as HTMLInputElement).type !== 'hidden') {
            issues.push(`❌ <${el.tagName.toLowerCase()}> has no associated label`)
          }
        })

        // Check heading hierarchy
        let lastLevel = 0
        document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
          const level = parseInt(h.tagName[1])
          if (level > lastLevel + 1 && lastLevel > 0) {
            issues.push(`⚠️ Heading skip: h${lastLevel} → h${level}`)
          }
          lastLevel = level
        })

        return issues.length > 0
          ? issues.join('\n')
          : '✅ No obvious accessibility issues found'
      },
    })

    return results?.[0]?.result || { success: false, error: 'No result' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ─── Get page performance metrics ───
export async function getPerformanceMetrics(
  tabId: number
): Promise<{ success: boolean; metrics?: Record<string, any>; error?: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const perf = performance
        const nav = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
        const paint = perf.getEntriesByType('paint')

        return {
          domContentLoaded: nav?.domContentLoadedEventEnd - nav?.domContentLoadedEventStart,
          loadComplete: nav?.loadEventEnd - nav?.loadEventStart,
          firstPaint: paint.find(p => p.name === 'first-paint')?.startTime,
          firstContentfulPaint: paint.find(p => p.name === 'first-contentful-paint')?.startTime,
          domInteractive: nav?.domInteractive,
          responseEnd: nav?.responseEnd,
          transferSize: nav?.transferSize,
          resourceCount: perf.getEntriesByType('resource').length,
        }
      },
    })

    return { success: true, metrics: results?.[0]?.result }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
