import React, { useState, useEffect, useCallback } from 'react'

interface TabInfo {
  id: number
  url: string
  title: string
  active: boolean
  index: number
  status?: string
}

// ─── Tab Manager Component ───
export function TabManager({ onTabSelect }: { onTabSelect?: (tabId: number) => void }) {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [currentTab, setCurrentTab] = useState<TabInfo | null>(null)
  const [newUrl, setNewUrl] = useState('')

  const refreshTabs = useCallback(async () => {
    const tabList = await chrome.runtime.sendMessage({ type: 'TAB_LIST' })
    if (Array.isArray(tabList)) setTabs(tabList)

    const current = await chrome.runtime.sendMessage({ type: 'TAB_CURRENT' })
    if (current && !current.error) setCurrentTab(current)
  }, [])

  useEffect(() => {
    refreshTabs()
    const interval = setInterval(refreshTabs, 5000)
    return () => clearInterval(interval)
  }, [refreshTabs])

  const handleSwitch = async (tabId: number) => {
    await chrome.runtime.sendMessage({ type: 'TAB_SWITCH', tabId })
    onTabSelect?.(tabId)
    refreshTabs()
  }

  const handleClose = async (tabId: number) => {
    await chrome.runtime.sendMessage({ type: 'TAB_CLOSE', tabId })
    refreshTabs()
  }

  const handleOpen = async () => {
    if (!newUrl.trim()) return
    const url = newUrl.startsWith('http') ? newUrl : `https://${newUrl}`
    await chrome.runtime.sendMessage({ type: 'TAB_OPEN', url })
    setNewUrl('')
    refreshTabs()
  }

  const handleReload = async (tabId?: number) => {
    await chrome.runtime.sendMessage({ type: 'TAB_RELOAD', tabId })
    refreshTabs()
  }

  const handleDuplicate = async (tabId: number) => {
    await chrome.runtime.sendMessage({ type: 'TAB_DUPLICATE', tabId })
    refreshTabs()
  }

  return (
    <div style={{ padding: 12 }}>
      {/* Current Tab */}
      {currentTab && (
        <div style={{ marginBottom: 12, padding: 8, background: '#1e293b', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>📍 Current Tab</div>
          <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{currentTab.title}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', wordBreak: 'break-all' }}>{currentTab.url}</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button onClick={() => handleReload()} style={smallBtn}>🔄 Reload</button>
            <button onClick={() => chrome.runtime.sendMessage({ type: 'TAB_BACK' }).then(refreshTabs)} style={smallBtn}>◀ Back</button>
            <button onClick={() => chrome.runtime.sendMessage({ type: 'TAB_FORWARD' }).then(refreshTabs)} style={smallBtn}>▶ Forward</button>
          </div>
        </div>
      )}

      {/* Open new tab */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <input
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          placeholder="URL to open..."
          style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
          onKeyDown={e => e.key === 'Enter' && handleOpen()}
        />
        <button onClick={handleOpen} style={{ ...smallBtn, background: '#6366f1' }}>➕</button>
      </div>

      {/* Tab list */}
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
        📑 Open Tabs ({tabs.length})
      </div>
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            style={{
              padding: '6px 8px',
              marginBottom: 4,
              background: tab.active ? '#1e293b' : '#0f172a',
              borderRadius: 4,
              borderLeft: tab.active ? '3px solid #6366f1' : '3px solid transparent',
              cursor: 'pointer',
            }}
            onClick={() => handleSwitch(tab.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  color: tab.active ? '#e2e8f0' : '#94a3b8',
                  fontWeight: tab.active ? 600 : 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {tab.title || tab.url}
                </div>
                <div style={{
                  fontSize: 10,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {tab.url}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginLeft: 4 }}>
                <button
                  onClick={e => { e.stopPropagation(); handleDuplicate(tab.id) }}
                  style={{ ...tinyBtn, title: 'Duplicate' }}
                >📋</button>
                <button
                  onClick={e => { e.stopPropagation(); handleClose(tab.id) }}
                  style={{ ...tinyBtn, color: '#ef4444' }}
                >✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Console Panel Component ───
export function ConsolePanel() {
  const [logs, setLogs] = useState<any[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [scriptInput, setScriptInput] = useState('')
  const [scriptResult, setScriptResult] = useState<string>('')
  const [capturing, setCapturing] = useState(false)

  const refreshLogs = useCallback(async () => {
    const fetched = await chrome.runtime.sendMessage({
      type: 'DEBUG_GET_LOGS',
      options: { limit: 100 },
    })
    if (Array.isArray(fetched)) setLogs(fetched)
  }, [])

  useEffect(() => {
    if (capturing) {
      const interval = setInterval(refreshLogs, 2000)
      return () => clearInterval(interval)
    }
  }, [capturing, refreshLogs])

  const startCapture = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    await chrome.runtime.sendMessage({ type: 'DEBUG_START_CAPTURE', tabId: tab.id })
    setCapturing(true)
  }

  const clearLogs = async () => {
    await chrome.runtime.sendMessage({ type: 'DEBUG_CLEAR_LOGS' })
    setLogs([])
  }

  const executeScript = async () => {
    if (!scriptInput.trim()) return
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return

    const result = await chrome.runtime.sendMessage({
      type: 'DEBUG_EXECUTE_SCRIPT',
      tabId: tab.id,
      script: scriptInput,
    })

    if (result?.success) {
      setScriptResult(typeof result.result === 'object'
        ? JSON.stringify(result.result, null, 2)
        : String(result.result ?? 'undefined'))
    } else {
      setScriptResult(`❌ Error: ${result?.error}`)
    }
  }

  const getAccessibility = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return

    const result = await chrome.runtime.sendMessage({
      type: 'DEBUG_ACCESSIBILITY',
      tabId: tab.id,
    })

    setScriptResult(result?.success ? result.summary : `❌ ${result?.error}`)
  }

  const getPerformance = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return

    const result = await chrome.runtime.sendMessage({
      type: 'DEBUG_PERFORMANCE',
      tabId: tab.id,
    })

    setScriptResult(result?.success
      ? JSON.stringify(result.metrics, null, 2)
      : `❌ ${result?.error}`)
  }

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.type === filter)

  return (
    <div style={{ padding: 12 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={capturing ? () => setCapturing(false) : startCapture} style={{
          ...smallBtn,
          background: capturing ? '#ef4444' : '#22c55e',
        }}>
          {capturing ? '⏹ Stop Capture' : '🔴 Start Capture'}
        </button>
        <button onClick={clearLogs} style={smallBtn}>🗑 Clear</button>
        <button onClick={getAccessibility} style={smallBtn}>♿ A11y Check</button>
        <button onClick={getPerformance} style={smallBtn}>⚡ Performance</button>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {['all', 'log', 'warn', 'error', 'info'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...tinyBtn,
              background: filter === f ? '#6366f1' : '#1e293b',
              color: filter === f ? '#fff' : '#94a3b8',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Log output */}
      <div style={{
        maxHeight: 200,
        overflow: 'auto',
        background: '#0c1222',
        borderRadius: 6,
        padding: 8,
        fontFamily: 'monospace',
        fontSize: 11,
        marginBottom: 8,
      }}>
        {filteredLogs.length === 0 ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>
            {capturing ? 'Listening for console output...' : 'Click "Start Capture" to begin'}
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div key={i} style={{
              color: log.type === 'error' ? '#ef4444'
                : log.type === 'warn' ? '#fbbf24'
                : log.type === 'info' ? '#38bdf8'
                : '#94a3b8',
              borderBottom: '1px solid #1e293b',
              padding: '2px 0',
            }}>
              <span style={{ color: '#64748b', marginRight: 4 }}>
                [{new Date(log.timestamp).toLocaleTimeString()}]
              </span>
              <span style={{ color: log.type === 'error' ? '#f87171' : '#64748b', marginRight: 4 }}>
                [{log.type}]
              </span>
              {log.args.join(' ')}
            </div>
          ))
        )}
      </div>

      {/* Script executor */}
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>💻 Execute JavaScript</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <textarea
          value={scriptInput}
          onChange={e => setScriptInput(e.target.value)}
          placeholder="document.title, navigator.userAgent, etc."
          style={{
            ...inputStyle,
            flex: 1,
            minHeight: 40,
            fontFamily: 'monospace',
            fontSize: 11,
            marginBottom: 0,
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              executeScript()
            }
          }}
        />
        <button onClick={executeScript} style={{ ...smallBtn, background: '#6366f1' }}>▶</button>
      </div>

      {/* Script result */}
      {scriptResult && (
        <div style={{
          background: '#0c1222',
          borderRadius: 6,
          padding: 8,
          fontFamily: 'monospace',
          fontSize: 11,
          color: scriptResult.startsWith('❌') ? '#ef4444' : '#22c55e',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 150,
          overflow: 'auto',
        }}>
          {scriptResult}
        </div>
      )}
    </div>
  )
}

// ─── Styles ───
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 4,
  color: '#e2e8f0',
  fontSize: 12,
  marginBottom: 4,
  outline: 'none',
}

const smallBtn: React.CSSProperties = {
  padding: '4px 8px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 4,
  color: '#e2e8f0',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const tinyBtn: React.CSSProperties = {
  padding: '2px 6px',
  background: 'transparent',
  border: '1px solid #334155',
  borderRadius: 3,
  color: '#94a3b8',
  fontSize: 10,
  cursor: 'pointer',
}
