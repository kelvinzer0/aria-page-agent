import React, { useState, useRef, useEffect, useCallback } from 'react'
import SYSTEM_PROMPT_TEMPLATE from '../../agent/system_prompt.md?raw'
import { TabManager, ConsolePanel } from './Panels'

interface StepResult {
  stepNumber: number
  evaluation: string
  memory: string
  nextGoal: string
  action: string
  actionResult: { success: boolean; message: string }
  timestamp: number
  duration: number
}

type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error'

// ─── API Provider types ───
type ApiProvider = 'gemini' | 'openai'

const PROVIDER_PRESETS: Record<ApiProvider, { endpoint: string; model: string }> = {
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
  },
  openai: {
    endpoint: 'https://router9.warunglakku.com/v1',
    model: 'zeroai',
  },
}

// ─── Retry helper for 429 ───
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options)

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      const waitMs = retryAfter
        ? parseInt(retryAfter) * 1000
        : Math.min(1000 * Math.pow(2, attempt), 30000)

      console.warn(`Rate limited (429). Waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`)
      await new Promise(r => setTimeout(r, waitMs))
      continue
    }

    return response
  }
  throw new Error('Max retries exceeded for rate limit')
}

// ─── Call Gemini API ───
async function callGemini(
  config: { apiKey: string; endpoint: string; model: string },
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const url = `${config.endpoint}/models/${config.model}:generateContent?key=${config.apiKey}`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Gemini API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// ─── Call OpenAI-compatible API ───
async function callOpenAI(
  config: { apiKey: string; endpoint: string; model: string },
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  // Normalize endpoint - remove trailing slash and /chat/completions if present
  let endpoint = config.endpoint.replace(/\/+$/, '')
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint = endpoint + '/chat/completions'
  }

  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that responds in JSON format when asked.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

// ─── Unified LLM call ───
async function callLLM(
  provider: ApiProvider,
  config: { apiKey: string; endpoint: string; model: string },
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  if (provider === 'gemini') {
    return callGemini(config, prompt, signal)
  } else {
    return callOpenAI(config, prompt, signal)
  }
}

// ─── Send message to content script with injection check ───
async function sendToContentScript(tabId: number, message: any): Promise<any> {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (err) {
    console.warn('Content script not responding, attempting injection...')
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      })
      await new Promise(r => setTimeout(r, 500))
      return await chrome.tabs.sendMessage(tabId, message)
    } catch (injectErr) {
      throw new Error(`Cannot connect to page. Make sure you're on a regular webpage (not chrome:// or extension page). Error: ${injectErr}`)
    }
  }
}

// ─── Config Panel ───
function ConfigPanel({ onSave }: { onSave: (config: AppConfig) => void }) {
  const [provider, setProvider] = useState<ApiProvider>(
    (localStorage.getItem('aom_provider') as ApiProvider) || 'openai'
  )
  const [apiKey, setApiKey] = useState(localStorage.getItem('aom_api_key') || '')
  const [endpoint, setEndpoint] = useState(localStorage.getItem('aom_endpoint') || PROVIDER_PRESETS.openai.endpoint)
  const [model, setModel] = useState(localStorage.getItem('aom_model') || PROVIDER_PRESETS.openai.model)
  const [language, setLanguage] = useState(localStorage.getItem('aom_language') || 'id')

  const handleProviderChange = (newProvider: ApiProvider) => {
    setProvider(newProvider)
    const preset = PROVIDER_PRESETS[newProvider]
    setEndpoint(preset.endpoint)
    setModel(preset.model)
  }

  return (
    <div style={{ padding: 16, borderBottom: '1px solid #1e293b' }}>
      <h3 style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>⚙️ Configuration</h3>

      {/* Provider selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button
          onClick={() => handleProviderChange('openai')}
          style={{
            ...providerBtnStyle,
            background: provider === 'openai' ? '#6366f1' : '#1e293b',
            border: provider === 'openai' ? '1px solid #818cf8' : '1px solid #334155',
          }}
        >
          🤖 OpenAI-compatible
        </button>
        <button
          onClick={() => handleProviderChange('gemini')}
          style={{
            ...providerBtnStyle,
            background: provider === 'gemini' ? '#6366f1' : '#1e293b',
            border: provider === 'gemini' ? '1px solid #818cf8' : '1px solid #334155',
          }}
        >
          ✨ Gemini
        </button>
      </div>

      <input
        type="password"
        placeholder="API Key"
        value={apiKey}
        onChange={e => setApiKey(e.target.value)}
        style={inputStyle}
      />
      <input
        placeholder="API Endpoint"
        value={endpoint}
        onChange={e => setEndpoint(e.target.value)}
        style={inputStyle}
      />
      <input
        placeholder="Model"
        value={model}
        onChange={e => setModel(e.target.value)}
        style={inputStyle}
      />
      <select
        value={language}
        onChange={e => setLanguage(e.target.value)}
        style={inputStyle}
      >
        <option value="en">English</option>
        <option value="zh">中文</option>
        <option value="id">Bahasa Indonesia</option>
      </select>
      <button
        onClick={() => {
          localStorage.setItem('aom_provider', provider)
          localStorage.setItem('aom_api_key', apiKey)
          localStorage.setItem('aom_endpoint', endpoint)
          localStorage.setItem('aom_model', model)
          localStorage.setItem('aom_language', language)
          onSave({ provider, apiKey, endpoint, model, language })
        }}
        style={buttonStyle}
      >
        Save
      </button>
    </div>
  )
}

// ─── Types ───
interface AppConfig {
  provider: ApiProvider
  apiKey: string
  endpoint: string
  model: string
  language: string
}

// ─── Main App ───
export default function App() {
  const [task, setTask] = useState('')
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [steps, setSteps] = useState<StepResult[]>([])
  const [configOpen, setConfigOpen] = useState(false)
  const [config, setConfig] = useState<AppConfig>({
    provider: (localStorage.getItem('aom_provider') as ApiProvider) || 'openai',
    apiKey: localStorage.getItem('aom_api_key') || '',
    endpoint: localStorage.getItem('aom_endpoint') || PROVIDER_PRESETS.openai.endpoint,
    model: localStorage.getItem('aom_model') || PROVIDER_PRESETS.openai.model,
    language: localStorage.getItem('aom_language') || 'id',
  })
  const [aomPreview, setAomPreview] = useState('')
  const [error, setError] = useState('')
  const [activeView, setActiveView] = useState<'agent' | 'tabs' | 'console'>('agent')
  const stepsEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps])

  // ─── Preview AOM ───
  const previewAom = useCallback(async () => {
    setError('')
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) { setError('No active tab found'); return }

    try {
      const state = await sendToContentScript(tab.id, {
        type: 'PAGE_CONTROL',
        action: 'get_browser_state',
      })

      if (state && !state.error) {
        setAomPreview([
          state.header,
          state.content,
          state.footer,
          '\n--- Issues ---',
          state.issues,
        ].join('\n'))
      } else {
        setError(state?.error || 'Failed to get page state')
      }
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  // ─── Run Agent ───
  const runAgent = useCallback(async () => {
    if (!task.trim() || !config.apiKey) return

    setStatus('running')
    setSteps([])
    setError('')
    abortRef.current = new AbortController()

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) { setError('No active tab found'); setStatus('error'); return }

    const history: any[] = []
    let stepCount = 0
    const maxSteps = 50
    const totalStartTime = Date.now()

    try {
      while (stepCount < maxSteps) {
        if (abortRef.current?.signal.aborted) break
        stepCount++
        const stepStart = Date.now()

        // Get browser state
        let state: any
        try {
          state = await sendToContentScript(tab.id, {
            type: 'PAGE_CONTROL',
            action: 'get_browser_state',
          })
        } catch (e: any) {
          setError(`Cannot connect to page: ${e.message}`)
          setStatus('error')
          return
        }

        if (!state || state.error) {
          setError(state?.error || 'Failed to get page state')
          setStatus('error')
          break
        }

        // Build prompt
        const langMap: Record<string, string> = { en: 'English', zh: '中文', id: 'Bahasa Indonesia' }
        const langName = langMap[config.language] || 'English'
        const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{{LANGUAGE}}', langName)

        // Collect additional context
        const tabList = await chrome.runtime.sendMessage({ type: 'TAB_LIST' }).catch(() => [])
        const consoleLogs = await chrome.runtime.sendMessage({ type: 'DEBUG_GET_LOGS', options: { limit: 20 } }).catch(() => [])

        const historyStr = history.map((h: any, i: number) =>
          `<step_${i + 1}>\nEval: ${h.eval}\nMemory: ${h.memory}\nGoal: ${h.goal}\nAction: ${h.action}\nResult: ${h.result}\n</step_${i + 1}>`
        ).join('\n')

        // Format tabs info
        const tabsInfo = Array.isArray(tabList)
          ? tabList.map((t: any) => `${t.active ? '→' : ' '} [${t.id}] ${t.title?.substring(0, 50) || t.url?.substring(0, 50)}`).join('\n')
          : 'Unable to fetch tabs'

        // Format console logs
        const consoleInfo = Array.isArray(consoleLogs) && consoleLogs.length > 0
          ? consoleLogs.map((l: any) => `[${l.type}] ${l.args?.join(' ')?.substring(0, 200)}`).join('\n')
          : 'No console output captured'

        const prompt = `${systemPrompt}

<user_request>USER REQUEST: ${task}</user_request>
${historyStr ? `\n<history>\n${historyStr}\n</history>` : ''}

<browser_state>
## Open Tabs
${tabsInfo}

## Current Tab: ${state.title || 'Unknown'}

## Landmarks
${state.landmarks || 'None'}

## Page Content
${state.header}
${state.content}
${state.footer}

## Accessibility Issues
${state.issues || 'None'}

## Recent Console Output
${consoleInfo}

## Recent Dialogs (alert/confirm/prompt)
${state.dialogs || 'No recent dialogs'}
</browser_state>

Analyze the browser state and determine your next action. Respond with JSON only.`

        // Call LLM
        const llmText = await callLLM(config.provider, config, prompt, abortRef.current?.signal)
        const parsed = JSON.parse(llmText)

        // Execute action
        let actionResult = { success: false, message: 'Unknown action' }
        const { type, params } = parsed.action

        if (type !== 'done') {
          // Tab management actions
          if (type === 'open_tab') {
            actionResult = await chrome.runtime.sendMessage({ type: 'TAB_OPEN', url: params.url })
          } else if (type === 'switch_tab') {
            actionResult = await chrome.runtime.sendMessage({ type: 'TAB_SWITCH', tabId: params.tab_id })
          } else if (type === 'close_tab') {
            actionResult = await chrome.runtime.sendMessage({ type: 'TAB_CLOSE', tabId: params.tab_id })
          } else if (type === 'navigate') {
            actionResult = await chrome.runtime.sendMessage({ type: 'TAB_NAVIGATE', url: params.url })
          } else if (type === 'go_back') {
            actionResult = await chrome.runtime.sendMessage({ type: 'TAB_BACK' })
          } else if (type === 'go_forward') {
            actionResult = await chrome.runtime.sendMessage({ type: 'TAB_FORWARD' })
          } else if (type === 'reload') {
            actionResult = await chrome.runtime.sendMessage({ type: 'TAB_RELOAD' })
          }
          // Debug actions
          else if (type === 'execute_javascript') {
            const jsResult = await chrome.runtime.sendMessage({
              type: 'DEBUG_EXECUTE_SCRIPT',
              tabId: tab.id,
              script: params.script,
            })
            if (jsResult?.success) {
              actionResult = {
                success: true,
                message: `✅ JS Result: ${JSON.stringify(jsResult.result)?.substring(0, 500)}`,
              }
            } else {
              actionResult = { success: false, message: jsResult?.error || 'JS execution failed' }
            }
          } else if (type === 'get_console_logs') {
            const logs = await chrome.runtime.sendMessage({
              type: 'DEBUG_GET_LOGS',
              options: { limit: params.limit || 20, type: params.filter },
            })
            actionResult = {
              success: true,
              message: Array.isArray(logs) && logs.length > 0
                ? logs.map((l: any) => `[${l.type}] ${l.args?.join(' ')?.substring(0, 200)}`).join('\n')
                : 'No console logs captured',
            }
          } else if (type === 'start_console_capture') {
            actionResult = await chrome.runtime.sendMessage({
              type: 'DEBUG_START_CAPTURE',
              tabId: tab.id,
            })
          }
          // Page interaction actions
          else {
            const actionMap: Record<string, string> = {
              'click': 'click_element', 'input_text': 'input_text', 'select_option': 'select_option',
              'scroll': 'scroll', 'press_key': 'press_key', 'toggle_check': 'toggle_check',
              'hover': 'hover', 'focus': 'focus',
            }
            const actionName = actionMap[type] || type

            let payload: any[]
            if (type === 'scroll') payload = [params]
            else if (type === 'input_text') payload = [params.index, params.text]
            else if (type === 'select_option') payload = [params.index, params.option_text || params.optionText]
            else if (type === 'press_key') payload = [params.index, params.key]
            else if (type === 'toggle_check') payload = [params.index, params.value]
            else payload = [params.index]

            try {
              actionResult = await sendToContentScript(tab.id, {
                type: 'PAGE_CONTROL',
                action: actionName,
                payload,
              })
            } catch (e: any) {
              actionResult = { success: false, message: e.message }
            }
          }
        }

        const step: StepResult = {
          stepNumber: stepCount,
          evaluation: parsed.evaluation,
          memory: parsed.memory,
          nextGoal: parsed.next_goal,
          action: `${type}(${JSON.stringify(params || {})})`,
          actionResult: type === 'done'
            ? { success: params?.success ?? true, message: params?.message || 'Done' }
            : actionResult,
          timestamp: stepStart,
          duration: Date.now() - stepStart,
        }

        setSteps(prev => [...prev, step])
        history.push({
          eval: parsed.evaluation,
          memory: parsed.memory,
          goal: parsed.next_goal,
          action: step.action,
          result: actionResult.message,
        })

        if (type === 'done') { setStatus('completed'); return }

        await new Promise(r => setTimeout(r, 800))
      }

      setStatus('completed')
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStatus('idle')
      } else {
        setStatus('error')
        setError(err.message)
        console.error('Agent error:', err)
      }
    }
  }, [task, config])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>♿</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Aria Page Agent</span>
          {status === 'running' && (
            <span style={{ fontSize: 11, color: '#fbbf24' }}>⏱ Running...</span>
          )}
          {status === 'completed' && steps.length > 0 && (
            <span style={{ fontSize: 11, color: '#22c55e' }}>
              ✅ {steps.length} steps • {((steps[steps.length - 1].timestamp + steps[steps.length - 1].duration - steps[0].timestamp) / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        <button
          onClick={() => setConfigOpen(!configOpen)}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}
        >
          ⚙️
        </button>
      </div>

      {/* Navigation tabs */}
      <div style={{
        display: 'flex',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
      }}>
        {([
          { key: 'agent' as const, label: '🤖 Agent', icon: '' },
          { key: 'tabs' as const, label: '📑 Tabs', icon: '' },
          { key: 'console' as const, label: '💻 Console', icon: '' },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key)}
            style={{
              flex: 1,
              padding: '8px 4px',
              background: activeView === tab.key ? '#0f172a' : 'transparent',
              border: 'none',
              borderBottom: activeView === tab.key ? '2px solid #6366f1' : '2px solid transparent',
              color: activeView === tab.key ? '#e2e8f0' : '#64748b',
              fontSize: 12,
              fontWeight: activeView === tab.key ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Config */}
      {configOpen && (
        <ConfigPanel onSave={(newConfig) => {
          setConfig(newConfig)
          setConfigOpen(false)
        }} />
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '8px 16px',
          background: '#7f1d1d',
          borderBottom: '1px solid #991b1b',
          fontSize: 12,
          color: '#fca5a5',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>❌ {error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* AOM Preview */}
      {aomPreview && (
        <div style={{
          maxHeight: 200,
          overflow: 'auto',
          padding: 12,
          background: '#0c1222',
          borderBottom: '1px solid #1e293b',
          fontSize: 11,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          color: '#64748b',
        }}>
          <button onClick={() => setAomPreview('')} style={{ float: 'right', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
          {aomPreview}
        </div>
      )}

      {/* Agent View */}
      {activeView === 'agent' && <>
        {steps.map((step, i) => (
          <div key={i} style={{
            marginBottom: 12,
            padding: 10,
            background: '#1e293b',
            borderRadius: 8,
            borderLeft: `3px solid ${step.actionResult.success ? '#22c55e' : '#ef4444'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Step {step.stepNumber} • {new Date(step.timestamp).toLocaleTimeString()} • {(step.duration / 1000).toFixed(1)}s
              </span>
              <span style={{ fontSize: 11, color: step.actionResult.success ? '#22c55e' : '#ef4444' }}>
                {step.actionResult.success ? '✓' : '✗'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>📊 {step.evaluation}</div>
            <div style={{ fontSize: 12, color: '#a78bfa', marginBottom: 4 }}>🧠 {step.memory}</div>
            <div style={{ fontSize: 12, color: '#38bdf8', marginBottom: 4 }}>🎯 {step.nextGoal}</div>
            <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 4 }}>⚡ {step.action}</div>
            <div style={{ fontSize: 12, color: '#e2e8f0' }}>{step.actionResult.message}</div>
          </div>
        ))}
        <div ref={stepsEndRef} />

      {/* Input */}
      <div style={{
        padding: 12,
        background: '#1e293b',
        borderTop: '1px solid #334155',
      }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={previewAom} style={{ ...buttonStyle, flex: 'none', fontSize: 12 }}>
            👁 Preview AOM
          </button>
          {status === 'running' ? (
            <button
              onClick={() => abortRef.current?.abort()}
              style={{ ...buttonStyle, background: '#ef4444', flex: 'none' }}
            >
              ⏹ Stop
            </button>
          ) : (
            <button
              onClick={runAgent}
              disabled={!task.trim() || !config.apiKey}
              style={{
                ...buttonStyle,
                flex: 1,
                opacity: (!task.trim() || !config.apiKey) ? 0.5 : 1,
              }}
            >
              {status === 'idle' ? '▶ Run' : status === 'completed' ? '▶ Run Again' : status}
            </button>
          )}
        </div>
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="Describe what you want to do on this page..."
          style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (task.trim() && config.apiKey && status !== 'running') runAgent()
            }
          }}
        />
      </div>
      </>}

      {/* Tabs View */}
      {activeView === 'tabs' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <TabManager />
        </div>
      )}

      {/* Console View */}
      {activeView === 'console' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <ConsolePanel />
        </div>
      )}
    </div>
  )
}

// ─── Styles ───
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 13,
  marginBottom: 6,
  outline: 'none',
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#6366f1',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const providerBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 12,
  cursor: 'pointer',
}
