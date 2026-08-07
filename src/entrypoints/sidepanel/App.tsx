import React, { useState, useRef, useEffect, useCallback } from 'react'
import SYSTEM_PROMPT_TEMPLATE from '../../agent/system_prompt.md?raw'

interface StepResult {
  stepNumber: number
  evaluation: string
  memory: string
  nextGoal: string
  action: string
  actionResult: { success: boolean; message: string }
}

type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error'

// ─── API Key Config ───
function ConfigPanel({ onSave }: { onSave: (key: string, endpoint: string, model: string, language: string) => void }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('aom_api_key') || '')
  const [endpoint, setEndpoint] = useState(localStorage.getItem('aom_endpoint') || 'https://generativelanguage.googleapis.com/v1beta')
  const [model, setModel] = useState(localStorage.getItem('aom_model') || 'gemini-2.0-flash')
  const [language, setLanguage] = useState(localStorage.getItem('aom_language') || 'en')

  return (
    <div style={{ padding: 16, borderBottom: '1px solid #1e293b' }}>
      <h3 style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>⚙️ Configuration</h3>
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
          localStorage.setItem('aom_api_key', apiKey)
          localStorage.setItem('aom_endpoint', endpoint)
          localStorage.setItem('aom_model', model)
          localStorage.setItem('aom_language', language)
          onSave(apiKey, endpoint, model, language)
        }}
        style={buttonStyle}
      >
        Save
      </button>
    </div>
  )
}

// ─── Main App ───
export default function App() {
  const [task, setTask] = useState('')
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [steps, setSteps] = useState<StepResult[]>([])
  const [configOpen, setConfigOpen] = useState(false)
  const [config, setConfig] = useState({
    apiKey: localStorage.getItem('aom_api_key') || '',
    endpoint: localStorage.getItem('aom_endpoint') || 'https://generativelanguage.googleapis.com/v1beta',
    model: localStorage.getItem('aom_model') || 'gemini-2.0-flash',
    language: localStorage.getItem('aom_language') || 'en',
  })
  const [aomPreview, setAomPreview] = useState('')
  const stepsEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-scroll to latest step
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps])

  // ─── Preview AOM ───
  const previewAom = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return

    const state = await chrome.tabs.sendMessage(tab.id, {
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
    }
  }, [])

  // ─── Run Agent ───
  const runAgent = useCallback(async () => {
    if (!task.trim() || !config.apiKey) return

    setStatus('running')
    setSteps([])
    abortRef.current = new AbortController()

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      setStatus('error')
      return
    }

    const history: any[] = []
    let stepCount = 0
    const maxSteps = 50

    try {
      while (stepCount < maxSteps) {
        if (abortRef.current?.signal.aborted) break
        stepCount++

        // Get browser state
        const state = await chrome.tabs.sendMessage(tab.id, {
          type: 'PAGE_CONTROL',
          action: 'get_browser_state',
        })

        if (!state || state.error) {
          setStatus('error')
          break
        }

        // Build prompt
        const historyStr = history.map((h: any, i: number) =>
          `<step_${i + 1}>\nEval: ${h.eval}\nMemory: ${h.memory}\nGoal: ${h.goal}\nAction: ${h.action}\nResult: ${h.result}\n</step_${i + 1}>`
        ).join('\n')

        const langMap: Record<string, string> = { en: 'English', zh: '中文', id: 'Bahasa Indonesia' }
        const langName = langMap[localStorage.getItem('aom_language') || 'en'] || 'English'
        const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{{LANGUAGE}}', langName)

        const prompt = `${systemPrompt}

<user_request>USER REQUEST: ${task}</user_request>
${historyStr ? `\n<history>\n${historyStr}\n</history>` : ''}

<browser_state>
## Landmarks
${state.landmarks || 'None'}

## Page Content
${state.header}
${state.content}
${state.footer}

## Issues
${state.issues || 'None'}
</browser_state>

Analyze the browser state and determine your next action. Respond with JSON only.`

        // Call LLM
        const response = await fetch(
          `${config.endpoint}/models/${config.model}:generateContent?key=${config.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortRef.current?.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 2048,
                responseMimeType: 'application/json',
              },
            }),
          }
        )

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const data = await response.json()
        const llmText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
        const parsed = JSON.parse(llmText)

        // Execute action
        let actionResult = { success: false, message: 'Unknown action' }
        const { type, params } = parsed.action

        if (type !== 'done') {
          actionResult = await chrome.tabs.sendMessage(tab.id, {
            type: 'PAGE_CONTROL',
            action: type === 'click' ? 'click_element'
              : type === 'input_text' ? 'input_text'
              : type === 'select_option' ? 'select_option'
              : type === 'scroll' ? 'scroll'
              : type === 'press_key' ? 'press_key'
              : type === 'toggle_check' ? 'toggle_check'
              : type === 'hover' ? 'hover'
              : type === 'focus' ? 'focus'
              : type,
            payload: type === 'scroll' ? params : [params.index, params.text || params.option_text || params.key || params.value].filter((_, i) => i === 0 || _ !== undefined),
          })
        }

        const step: StepResult = {
          stepNumber: stepCount,
          evaluation: parsed.evaluation,
          memory: parsed.memory,
          nextGoal: parsed.next_goal,
          action: `${type}(${JSON.stringify(params || {})})`,
          actionResult: type === 'done' ? { success: params?.success ?? true, message: params?.message || 'Done' } : actionResult,
        }

        setSteps(prev => [...prev, step])
        history.push({
          eval: parsed.evaluation,
          memory: parsed.memory,
          goal: parsed.next_goal,
          action: step.action,
          result: actionResult.message,
        })

        if (type === 'done') {
          setStatus('completed')
          return
        }

        // Wait for page to settle
        await new Promise(r => setTimeout(r, 800))
      }

      setStatus('completed')
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setStatus('idle')
      } else {
        setStatus('error')
        console.error('Agent error:', error)
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
        </div>
        <button
          onClick={() => setConfigOpen(!configOpen)}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}
        >
          ⚙️
        </button>
      </div>

      {/* Config */}
      {configOpen && (
        <ConfigPanel onSave={(apiKey, endpoint, model, language) => {
          setConfig({ apiKey, endpoint, model, language })
          setConfigOpen(false)
        }} />
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

      {/* Steps */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            marginBottom: 12,
            padding: 10,
            background: '#1e293b',
            borderRadius: 8,
            borderLeft: `3px solid ${step.actionResult.success ? '#22c55e' : '#ef4444'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Step {step.stepNumber}</span>
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
      </div>

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
          style={{
            ...inputStyle,
            minHeight: 60,
            resize: 'vertical',
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (task.trim() && config.apiKey && status !== 'running') runAgent()
            }
          }}
        />
      </div>
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
