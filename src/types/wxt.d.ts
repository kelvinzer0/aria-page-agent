/// <reference types="wxt/vite-builder" />

// WXT auto-imports
declare function defineBackground(entrypoint: (ctx: { on: (event: string, cb: (...args: any[]) => void) => void }) => void): void
declare function defineContentScript(config: {
  matches: string[]
  runAt?: 'document_start' | 'document_end' | 'document_idle'
  main: (ctx: { on: (event: string, cb: (...args: any[]) => void) => void }) => void
}): void

// Raw file imports
declare module '*.md?raw' {
  const content: string
  export default content
}
