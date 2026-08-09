/**
 * Shared console log store
 * Single source of truth for captured console logs.
 * Both background.ts (writer) and tools.ts (reader) import from here.
 */

export interface ConsoleLogEntry {
  type: 'log' | 'warn' | 'error' | 'info' | 'debug'
  args: string[]
  timestamp: number
  source?: string
}

const MAX_LOGS = 500
let logs: ConsoleLogEntry[] = []

export function pushConsoleLog(entry: ConsoleLogEntry): void {
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
}

export function getStoredConsoleLogs(options?: {
  limit?: number
  type?: string
}): ConsoleLogEntry[] {
  let result = [...logs]
  if (options?.type) result = result.filter(l => l.type === options.type)
  if (options?.limit) result = result.slice(-options.limit)
  return result
}

export function clearStoredConsoleLogs(): void {
  logs = []
}
