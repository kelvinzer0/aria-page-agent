import React, { useState, useEffect, useCallback } from 'react'

type BridgeStatus = 'disconnected' | 'connecting' | 'connected'

interface BridgeState {
  connected: boolean
  room?: string
  mcpUrl?: string
  url?: string
}

export function BridgePanel() {
  const [bridgeUrl, setBridgeUrl] = useState('https://mcp-bridge.insidexofficial.workers.dev')
  const [scopeConfig, setScopeConfig] = useState('')
  const [state, setState] = useState<BridgeState>({ connected: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Load bridgeUrl & scopeConfig from chrome.storage on mount
  useEffect(() => {
    chrome.storage.local.get(['bridgeUrl', 'scopeConfig'], (result) => {
      if (result.bridgeUrl) setBridgeUrl(result.bridgeUrl)
      if (result.scopeConfig) setScopeConfig(result.scopeConfig)
    })
  }, [])

  // Poll status
  const refreshStatus = useCallback(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' })
    setState(status)
  }, [])

  useEffect(() => {
    refreshStatus()
    const interval = setInterval(refreshStatus, 3000)
    return () => clearInterval(interval)
  }, [refreshStatus])

  // Start bridge
  const handleStart = async () => {
    if (!bridgeUrl.trim()) return

    setLoading(true)
    setError('')
    // Save to chrome.storage (persists across extension updates/restarts)
    chrome.storage.local.set({ bridgeUrl: bridgeUrl.trim(), scopeConfig: scopeConfig.trim() })

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'BRIDGE_START',
        url: bridgeUrl.trim().replace(/\/+$/, ''),
      })

      if (result?.error) {
        setError(result.error)
      } else {
        setState({
          connected: true,
          room: result.room,
          mcpUrl: result.mcpUrl,
          url: bridgeUrl,
        })
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Stop bridge
  const handleStop = async () => {
    await chrome.runtime.sendMessage({ type: 'BRIDGE_STOP' })
    setState({ connected: false })
  }

  // Reset room (force new room on next connect)
  const handleResetRoom = async () => {
    if (!window.confirm('This will generate a new room ID and change your MCP URL.\nYou will need to update your MCP client config.\n\nContinue?')) return
    await chrome.runtime.sendMessage({ type: 'BRIDGE_RESET_ROOM' })
    setState({ connected: false })
  }

  // Copy MCP URL
  const copyMcpUrl = () => {
    if (state.mcpUrl) {
      navigator.clipboard.writeText(state.mcpUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, color: '#e2e8f0', marginBottom: 12 }}>
        🌉 MCP Bridge
      </h3>

      <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
        Connect this extension to a Cloudflare Workers bridge. AI agents can then
        control this browser via MCP protocol.
      </p>

      {/* Bridge URL Input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>
          Bridge URL
        </label>
        <input
          type="text"
          value={bridgeUrl}
          onChange={e => setBridgeUrl(e.target.value)}
          placeholder="https://mcp-bridge.<subdomain>.workers.dev"
          disabled={state.connected}
          style={{
            width: '100%',
            padding: '8px 10px',
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 6,
            color: '#e2e8f0',
            fontSize: 13,
            outline: 'none',
            opacity: state.connected ? 0.5 : 1,
          }}
        />
      </div>

      {/* Scope Config Input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>
          Scope Configuration (JSON)
        </label>
        <textarea
          value={scopeConfig}
          onChange={e => {
            setScopeConfig(e.target.value)
            chrome.storage.local.set({ scopeConfig: e.target.value })
          }}
          placeholder='{"target": {"scope": {...}}}'
          style={{
            width: '100%',
            height: '80px',
            padding: '8px 10px',
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 6,
            color: '#e2e8f0',
            fontSize: 11,
            fontFamily: 'monospace',
            outline: 'none',
            resize: 'vertical',
          }}
        />
      </div>


      {/* Start/Stop + Reset Room Buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {state.connected ? (
          <button
            onClick={handleStop}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: '#ef4444',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⏹ Stop Bridge
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={loading || !bridgeUrl.trim()}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: '#22c55e',
              border: 'none',
              borderRadius: 6,
              color: '#000',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              opacity: (!bridgeUrl.trim() || loading) ? 0.5 : 1,
            }}
          >
            {loading ? '⏳ Connecting...' : '▶ Start Bridge'}
          </button>
        )}
        <button
          onClick={handleResetRoom}
          title="Generate a new room ID (changes MCP URL)"
          style={{
            padding: '10px 10px',
            background: '#1e293b',
            border: '1px solid #475569',
            borderRadius: 6,
            color: '#94a3b8',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          🔄
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '8px 12px',
          background: '#7f1d1d',
          borderRadius: 6,
          fontSize: 12,
          color: '#fca5a5',
          marginBottom: 12,
        }}>
          ❌ {error}
        </div>
      )}

      {/* Status Card */}
      <div style={{
        padding: 12,
        background: state.connected ? '#052e16' : '#1e293b',
        border: `1px solid ${state.connected ? '#166534' : '#334155'}`,
        borderRadius: 8,
      }}>
        {/* Status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: state.connected ? '#22c55e' : '#64748b',
          }} />
          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>
            {state.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* Room info */}
        {state.connected && state.room && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>Room: </span>
            <span style={{ fontSize: 13, color: '#4ade80', fontFamily: 'monospace' }}>
              {state.room}
            </span>
          </div>
        )}

        {/* MCP URL */}
        {state.connected && state.mcpUrl && (
          <div>
            <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>
              MCP Endpoint (copy to client):
            </span>
            <div style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
            }}>
              <code style={{
                flex: 1,
                padding: '6px 8px',
                background: '#0f172a',
                borderRadius: 4,
                fontSize: 11,
                color: '#4ade80',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}>
                {state.mcpUrl}
              </code>
              <button
                onClick={copyMcpUrl}
                style={{
                  padding: '6px 10px',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  color: '#e2e8f0',
                  fontSize: 12,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? '✅' : '📋'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Usage instructions */}
      {state.connected && (
        <div style={{
          marginTop: 16,
          padding: 12,
          background: '#1e293b',
          borderRadius: 8,
          fontSize: 12,
          color: '#94a3b8',
        }}>
          <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>
            📖 How to use:
          </div>
          <ol style={{ margin: 0, paddingLeft: 16 }}>
            <li style={{ marginBottom: 4 }}>
              Copy the MCP endpoint URL above
            </li>
            <li style={{ marginBottom: 4 }}>
              Add it to your MCP client (OpenCode, Claude, Cursor, OpenClaw)
            </li>
            <li style={{ marginBottom: 4 }}>
              Browse any webpage — tools auto-register based on page context
            </li>
            <li>
              AI agent can now control this browser!
            </li>
          </ol>
        </div>
      )}
    </div>
  )
}
