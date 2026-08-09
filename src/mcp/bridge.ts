/**
 * MCP Bridge Client
 *
 * Connects to Cloudflare Workers bridge via WebSocket.
 * Registers extension tools and handles tool calls.
 */

export interface BridgeConfig {
  url: string
  room?: string
}

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected'

export type BridgeStatusListener = (status: BridgeStatus, room?: string) => void

export class MCPBridgeClient {
  private ws: WebSocket | null = null
  private config: BridgeConfig
  private status: BridgeStatus = 'disconnected'
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null
  private statusListeners: BridgeStatusListener[] = []
  private toolCallHandler: ((name: string, params: Record<string, unknown>) => Promise<ToolResult>) | null = null
  private room: string = ''

  constructor(config: BridgeConfig) {
    this.config = config
    this.room = config.room || ''
  }

  // ─── Public API ───

  connect(): void {
    if (this.ws) this.disconnect()

    this.setStatus('connecting')
    this.createRoom()
  }

  disconnect(): void {
    this.clearReconnect()
    if (this.keepaliveInterval) { clearInterval(this.keepaliveInterval); this.keepaliveInterval = null }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.room = ''
    this.setStatus('disconnected')
  }

  isConnected(): boolean {
    return this.status === 'connected'
  }

  getRoom(): string {
    return this.room
  }

  getMcpUrl(): string {
    if (!this.room) return ''
    return `${this.config.url}/mcp?room=${this.room}`
  }

  getStatus(): BridgeStatus {
    return this.status
  }

  onStatusChange(listener: BridgeStatusListener): void {
    this.statusListeners.push(listener)
  }

  setToolCallHandler(handler: (name: string, params: Record<string, unknown>) => Promise<ToolResult>): void {
    this.toolCallHandler = handler
  }

  // ─── Create Room ───

  private async createRoom(): Promise<void> {
    try {
      const baseUrl = this.config.url.replace(/\/+$/, '')
      const res = await fetch(`${baseUrl}/mcp/new`)
      const data = await res.json()

      this.room = data.room
      this.connectWebSocket(data.extension_url)
    } catch (err) {
      console.error('[MCPBridge] Failed to create room:', err)
      this.setStatus('disconnected')
    }
  }

  // ─── WebSocket Connection ───

  private connectWebSocket(wsUrl: string): void {
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.setStatus('connected')
      console.log('[MCPBridge] Connected, room:', this.room)
      // Keepalive ping to prevent Chrome SW termination
      // Send first ping immediately, then every 25s
      const sendPing = () => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'pong' }))
        }
      }
      sendPing()
      this.keepaliveInterval = setInterval(sendPing, 25000)
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        this.handleMessage(msg)
      } catch (err) {
        console.error('[MCPBridge] Bad message:', err)
      }
    }

    this.ws.onclose = () => {
      this.ws = null
      if (this.keepaliveInterval) { clearInterval(this.keepaliveInterval); this.keepaliveInterval = null }
      this.setStatus('disconnected')
      // Auto-reconnect after 5s
      this.reconnectTimer = setTimeout(() => {
        if (this.config.url) this.createRoom()
      }, 5000)
    }

    this.ws.onerror = (err) => {
      console.error('[MCPBridge] WS error:', err)
    }
  }

  // ─── Message Handling ───

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'callTool':
        this.handleToolCall(msg.callId, msg.name, msg.params)
        break
      case 'ping':
        this.send({ type: 'pong' })
        break
    }
  }

  private async handleToolCall(callId: string, name: string, params: Record<string, unknown>): Promise<void> {
    if (!this.toolCallHandler) {
      this.sendResult(callId, {
        content: [{ type: 'text', text: 'No tool handler registered' }],
        isError: true,
      })
      return
    }

    try {
      const result = await this.toolCallHandler(name, params)
      this.sendResult(callId, result)
    } catch (err) {
      this.sendResult(callId, {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      })
    }
  }

  // ─── Send Messages ───

  registerTools(tools: ToolDefinition[]): void {
    console.log('[MCPBridge] registerTools called, ws state:', this.ws?.readyState, 'OPEN:', WebSocket.OPEN)
    this.send({ type: 'registerTools', tools })
    console.log('[MCPBridge] registerTools sent')
  }

  unregisterTools(names: string[]): void {
    this.send({ type: 'unregisterTools', names })
  }

  private sendResult(callId: string, result: ToolResult): void {
    this.send({ type: 'toolResult', callId, result })
  }

  private send(msg: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[MCPBridge] Sending:', msg.type)
      this.ws.send(JSON.stringify(msg))
    } else {
      console.log('[MCPBridge] send SKIPPED, ws state:', this.ws?.readyState)
    }
  }

  // ─── Helpers ───

  private setStatus(status: BridgeStatus): void {
    this.status = status
    for (const listener of this.statusListeners) {
      listener(status, this.room)
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

// ─── Types ───

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}
