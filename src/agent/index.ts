/**
 * Agent Controller
 *
 * Orchestrates the LLM agent loop:
 * 1. Build AOM from current page
 * 2. Serialize to LLM-friendly format
 * 3. Send to LLM with available actions
 * 4. Parse LLM response and execute actions
 * 5. Repeat until task complete
 */

import { traverse, resetTraverse, getAllIssues } from '../aom/traverse'
import { serializeToBrowserState } from '../aom/serializer'
import {
  buildIndexMap,
  clickElement,
  inputText,
  selectOption,
  scroll,
  pressKey,
  hoverElement,
  focusElement,
  toggleCheck,
  type ActionResult,
  type ScrollOptions,
} from '../executor'

// ─── Types ───
export interface AgentConfig {
  apiKey?: string
  apiEndpoint?: string
  model?: string
  maxSteps?: number
  language?: 'en' | 'zh' | 'id'
  onStatusChange?: (status: AgentStatus) => void
  onStepComplete?: (step: StepResult) => void
  onError?: (error: string) => void
}

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error'

export interface StepResult {
  stepNumber: number
  evaluation: string
  memory: string
  nextGoal: string
  action: string
  actionResult: ActionResult
  browserState: string
}

export interface AgentAction {
  type: string
  params: Record<string, any>
}

// ─── System Prompt ───
function buildSystemPrompt(language: string): string {
  const langMap: Record<string, string> = { en: 'English', zh: '中文', id: 'Bahasa Indonesia' }
  const langName = langMap[language] || 'English'

  return `You are an AI browser agent powered by ARIA Accessibility Object Model. You see web pages like a screen reader - understanding semantic meaning, relationships, and structure.

<language>Default working language: ${langName}. Reply in the user's language.</language>

<input>
Your input consists of:
1. <browser_state>: The Accessibility Object Model showing page structure, roles, names, states, and relationships
2. <agent_history>: Your previous actions and their results
3. <user_request>: The task to accomplish
</input>

<browser_state>
The browser state uses ARIA semantics:
- [index] = interactive element you can act on
- Role icons: →=link 🔘=button 📝=input ☐=checkbox ◉=radio 🖼=image 📊=table
- {state} = element state (checked, expanded, disabled, etc.)
- Indentation shows parent-child hierarchy
- Relations shown as (labelled-by, described-by, controls, owns)
- Table cells show column/row header context
</browser_state>

<actions>
You can perform these actions:
- click(index): Click an element by its [index]
- input_text(index, text): Type text into an input field
- select_option(index, option_text): Select from a dropdown
- toggle_check(index, value): Check/uncheck a checkbox
- hover(index): Hover over an element
- focus(index): Focus an element
- press_key(index, key): Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.)
- scroll(direction, amount?, pages?, target_index?): Scroll the page or an element
- done(success, message): Complete the task and report results
</actions>

<reasoning>
At each step:
1. Evaluate: Did the previous action succeed? Check the actual result.
2. Remember: Track progress, counts, and important findings.
3. Plan: What's the next logical action toward the goal?
4. Act: Execute one clear action.
5. If stuck after 3 attempts, try alternative approaches.
6. If captcha or login required, report to user and stop.
</reasoning>

<output>
Respond with JSON:
{
  "evaluation": "One sentence: did the last action succeed?",
  "memory": "1-3 sentences tracking progress",
  "next_goal": "One sentence: what to do next",
  "action": {
    "type": "click|input_text|select_option|toggle_check|hover|focus|press_key|scroll|done",
    "params": { ... }
  }
}
</output>`
}

// ─── Agent Controller ───
export class AgentController {
  private config: Required<AgentConfig>
  private status: AgentStatus = 'idle'
  private stepCount = 0
  private history: StepResult[] = []
  private abortController: AbortController | null = null

  constructor(config: AgentConfig) {
    this.config = {
      apiKey: config.apiKey || '',
      apiEndpoint: config.apiEndpoint || 'https://generativelanguage.googleapis.com/v1beta',
      model: config.model || 'gemini-2.0-flash',
      maxSteps: config.maxSteps || 50,
      language: config.language || 'en',
      onStatusChange: config.onStatusChange || (() => {}),
      onStepComplete: config.onStepComplete || (() => {}),
      onError: config.onError || (() => {}),
    }
  }

  // ─── Main Execute Loop ───
  async execute(task: string): Promise<string> {
    this.setStatus('running')
    this.stepCount = 0
    this.history = []
    this.abortController = new AbortController()

    try {
      while (this.stepCount < this.config.maxSteps) {
        if (this.abortController.signal.aborted) {
          return 'Task aborted by user.'
        }

        this.stepCount++

        // 1. Build AOM
        resetTraverse()
        const root = traverse(document.body)
        if (!root) {
          throw new Error('Failed to build AOM - page may be empty')
        }

        // 2. Build index map
        buildIndexMap(root)

        // 3. Serialize to browser state
        const issues = getAllIssues()
        const state = serializeToBrowserState(root, issues)

        // 4. Build prompt with history
        const prompt = this.buildPrompt(task, state)

        // 5. Call LLM
        const llmResponse = await this.callLLM(prompt)

        // 6. Parse response
        const parsed = this.parseResponse(llmResponse)

        // 7. Execute action
        const actionResult = await this.executeAction(parsed.action)

        // 8. Record step
        const stepResult: StepResult = {
          stepNumber: this.stepCount,
          evaluation: parsed.evaluation,
          memory: parsed.memory,
          nextGoal: parsed.next_goal,
          action: JSON.stringify(parsed.action),
          actionResult,
          browserState: state.content.substring(0, 500),
        }

        this.history.push(stepResult)
        this.config.onStepComplete(stepResult)

        // 9. Check if done
        if (parsed.action.type === 'done') {
          this.setStatus('completed')
          return parsed.action.params?.message || 'Task completed.'
        }

        // Wait for page to settle
        await this.sleep(800)
      }

      this.setStatus('completed')
      return `Reached maximum steps (${this.config.maxSteps}). Task may be incomplete.`
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.setStatus('error')
      this.config.onError(msg)
      return `Error: ${msg}`
    }
  }

  stop(): void {
    this.abortController?.abort()
    this.setStatus('idle')
  }

  getStatus(): AgentStatus {
    return this.status
  }

  getHistory(): StepResult[] {
    return [...this.history]
  }

  // ─── Build Full Prompt ───
  private buildPrompt(task: string, state: ReturnType<typeof serializeToBrowserState>): string {
    const historyStr = this.history.length > 0
      ? `\n<agent_history>\n${this.history.map(h =>
          `<step_${h.stepNumber}>\nEvaluation: ${h.evaluation}\nMemory: ${h.memory}\nNext Goal: ${h.nextGoal}\nAction: ${h.action}\nResult: ${h.actionResult.message}\n</step_${h.stepNumber}>`
        ).join('\n')}\n</agent_history>`
      : ''

    return `${buildSystemPrompt(this.config.language)}

<user_request>USER REQUEST: ${task}</user_request>
${historyStr}

<browser_state>
## Open Tabs
Current tab: ${state.title}

## Landmarks
${state.landmarks}

## Page Content
${state.header}
${state.content}
${state.footer}

## Accessibility Issues
${state.issues}
</browser_state>

Analyze the browser state and determine your next action. Respond with JSON only.`
  }

  // ─── Call LLM API ───
  private async callLLM(prompt: string): Promise<string> {
    const { apiKey, apiEndpoint, model } = this.config

    if (!apiKey) {
      throw new Error('API key not configured. Set it in the extension settings.')
    }

    const url = `${apiEndpoint}/models/${model}:generateContent?key=${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: this.abortController?.signal,
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
      const errorText = await response.text()
      throw new Error(`LLM API error ${response.status}: ${errorText}`)
    }

    const data = await response.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  }

  // ─── Parse LLM Response ───
  private parseResponse(response: string): { evaluation: string; memory: string; next_goal: string; action: AgentAction } {
    try {
      // Try direct JSON parse
      const parsed = JSON.parse(response)
      return {
        evaluation: parsed.evaluation || '',
        memory: parsed.memory || '',
        next_goal: parsed.next_goal || '',
        action: parsed.action || { type: 'done', params: { success: false, message: 'No action in response' } },
      }
    } catch {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0])
          return {
            evaluation: parsed.evaluation || '',
            memory: parsed.memory || '',
            next_goal: parsed.next_goal || '',
            action: parsed.action || { type: 'done', params: { success: false, message: 'No action in response' } },
          }
        } catch { /* fall through */ }
      }

      // Fallback: try to extract action from text
      return {
        evaluation: 'Failed to parse LLM response',
        memory: 'Response was not valid JSON',
        next_goal: 'Retry with cleaner prompt',
        action: { type: 'done', params: { success: false, message: `Invalid response: ${response.substring(0, 200)}` } },
      }
    }
  }

  // ─── Execute Action ───
  private async executeAction(action: AgentAction): Promise<ActionResult> {
    const { type, params } = action

    switch (type) {
      case 'click':
        return clickElement(params.index)
      case 'input_text':
        return inputText(params.index, params.text)
      case 'select_option':
        return selectOption(params.index, params.option_text || params.optionText)
      case 'toggle_check':
        return toggleCheck(params.index, params.value)
      case 'hover':
        return hoverElement(params.index)
      case 'focus':
        return focusElement(params.index)
      case 'press_key':
        return pressKey(params.index ?? null, params.key)
      case 'scroll':
        return scroll({
          direction: params.direction || 'down',
          amount: params.amount,
          pages: params.pages || params.num_pages,
          targetIndex: params.target_index || params.targetIndex,
        })
      case 'done':
        return { success: params.success ?? true, message: params.message || 'Done' }
      default:
        return { success: false, message: `Unknown action type: ${type}` }
    }
  }

  // ─── Helpers ───
  private setStatus(status: AgentStatus): void {
    this.status = status
    this.config.onStatusChange(status)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
