/**
 * Element Action Executor
 *
 * Performs actions on DOM elements identified by their AOM interactive index.
 * Actions are dispatched to the actual DOM elements via the AOM tree.
 */

import type { AomElement } from '../aom/types'

export interface ActionResult {
  success: boolean
  message: string
}

export interface ScrollOptions {
  direction: 'up' | 'down' | 'left' | 'right'
  amount?: number  // pixels, or pages if pages is set
  pages?: number
  targetIndex?: number  // scroll within element
}

// ─── Element Lookup ───
const indexMap = new Map<number, AomElement>()

export function buildIndexMap(root: AomElement): void {
  indexMap.clear()
  const collect = (el: AomElement) => {
    if (el.isInteractive && el.interactiveIndex !== null) {
      indexMap.set(el.interactiveIndex, el)
    }
    for (const child of el.children) {
      collect(child)
    }
  }
  collect(root)
}

export function getElementByIndex(index: number): AomElement | undefined {
  return indexMap.get(index)
}

// ─── Click ───
export async function clickElement(index: number): Promise<ActionResult> {
  const el = getElementByIndex(index)
  if (!el?.domNode) {
    return { success: false, message: `Element [${index}] not found` }
  }

  try {
    // Scroll into view first
    el.domNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(200)

    // Focus if focusable
    if (typeof el.domNode.focus === 'function') {
      el.domNode.focus()
    }

    // Dispatch click events
    const rect = el.domNode.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2

    el.domNode.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    el.domNode.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    el.domNode.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))

    const name = el.accessibleName.trim() || el.htmlTag
    return { success: true, message: `✅ Clicked [${index}] <${el.htmlTag}> "${name}"` }
  } catch (error) {
    return { success: false, message: `❌ Failed to click [${index}]: ${error}` }
  }
}

// ─── Input Text ───
export async function inputText(index: number, text: string): Promise<ActionResult> {
  const el = getElementByIndex(index)
  if (!el?.domNode) {
    return { success: false, message: `Element [${index}] not found` }
  }

  const domNode = el.domNode

  try {
    domNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(200)

    // Focus
    if (typeof (domNode as HTMLInputElement).focus === 'function') {
      (domNode as HTMLInputElement).focus()
    }

    // Clear existing value
    if ('value' in domNode) {
      ;(domNode as HTMLInputElement).value = ''
      domNode.dispatchEvent(new Event('input', { bubbles: true }))
    }

    // Type text character by character for better compatibility
    for (const char of text) {
      domNode.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
      domNode.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }))

      if ('value' in domNode) {
        ;(domNode as HTMLInputElement).value += char
      }

      domNode.dispatchEvent(new Event('input', { bubbles: true }))
      domNode.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
    }

    // Also set the value directly for reliability
    if ('value' in domNode) {
      ;(domNode as HTMLInputElement).value = text
      domNode.dispatchEvent(new Event('input', { bubbles: true }))
      domNode.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const name = el.accessibleName.trim() || el.htmlTag
    return { success: true, message: `✅ Typed "${text}" into [${index}] <${el.htmlTag}> "${name}"` }
  } catch (error) {
    return { success: false, message: `❌ Failed to input text into [${index}]: ${error}` }
  }
}

// ─── Select Option ───
export async function selectOption(index: number, optionText: string): Promise<ActionResult> {
  const el = getElementByIndex(index)
  if (!el?.domNode) {
    return { success: false, message: `Element [${index}] not found` }
  }

  const domNode = el.domNode as HTMLSelectElement

  try {
    domNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(200)
    domNode.focus()

    // Find matching option
    const options = Array.from(domNode.options)
    const match = options.find(o =>
      o.text.toLowerCase().includes(optionText.toLowerCase()) ||
      o.value.toLowerCase() === optionText.toLowerCase()
    )

    if (!match) {
      return {
        success: false,
        message: `❌ Option "${optionText}" not found. Available: ${options.map(o => o.text).join(', ')}`,
      }
    }

    domNode.value = match.value
    domNode.dispatchEvent(new Event('change', { bubbles: true }))

    const name = el.accessibleName.trim() || el.htmlTag
    return { success: true, message: `✅ Selected "${match.text}" in [${index}] <select> "${name}"` }
  } catch (error) {
    return { success: false, message: `❌ Failed to select option in [${index}]: ${error}` }
  }
}

// ─── Scroll ───
export async function scroll(options: ScrollOptions): Promise<ActionResult> {
  try {
    let targetEl: Element | null = null

    if (options.targetIndex !== undefined) {
      const el = getElementByIndex(options.targetIndex)
      if (!el?.domNode) {
        return { success: false, message: `Element [${options.targetIndex}] not found` }
      }
      targetEl = el.domNode
    }

    const pixels = options.pages
      ? options.pages * window.innerHeight
      : options.amount || window.innerHeight * 0.8

    const scrollX = options.direction === 'left' ? -pixels : options.direction === 'right' ? pixels : 0
    const scrollY = options.direction === 'up' ? -pixels : options.direction === 'down' ? pixels : 0

    if (targetEl) {
      targetEl.scrollBy({ left: scrollX, top: scrollY, behavior: 'smooth' })
    } else {
      window.scrollBy({ left: scrollX, top: scrollY, behavior: 'smooth' })
    }

    await sleep(500)

    return {
      success: true,
      message: `✅ Scrolled ${options.direction} by ${pixels.toFixed(0)}px`,
    }
  } catch (error) {
    return { success: false, message: `❌ Failed to scroll: ${error}` }
  }
}

// ─── Press Key ───
export async function pressKey(index: number | null, key: string): Promise<ActionResult> {
  const target = index !== null ? getElementByIndex(index)?.domNode : document.activeElement

  if (!target) {
    return { success: false, message: index !== null ? `Element [${index}] not found` : 'No focused element' }
  }

  try {
    const keyEvent = {
      key,
      code: `Key${key.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    }

    target.dispatchEvent(new KeyboardEvent('keydown', keyEvent))
    target.dispatchEvent(new KeyboardEvent('keypress', keyEvent))
    target.dispatchEvent(new KeyboardEvent('keyup', keyEvent))

    // Special keys
    if (key === 'Enter' && target instanceof HTMLAnchorElement) {
      target.click()
    }

    return { success: true, message: `✅ Pressed "${key}" on ${index !== null ? `[${index}]` : 'focused element'}` }
  } catch (error) {
    return { success: false, message: `❌ Failed to press key: ${error}` }
  }
}

// ─── Hover ───
export async function hoverElement(index: number): Promise<ActionResult> {
  const el = getElementByIndex(index)
  if (!el?.domNode) {
    return { success: false, message: `Element [${index}] not found` }
  }

  try {
    el.domNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(200)

    const rect = el.domNode.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2

    el.domNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }))
    el.domNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }))
    el.domNode.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))

    const name = el.accessibleName.trim() || el.htmlTag
    return { success: true, message: `✅ Hovered [${index}] <${el.htmlTag}> "${name}"` }
  } catch (error) {
    return { success: false, message: `❌ Failed to hover [${index}]: ${error}` }
  }
}

// ─── Focus ───
export async function focusElement(index: number): Promise<ActionResult> {
  const el = getElementByIndex(index)
  if (!el?.domNode) {
    return { success: false, message: `Element [${index}] not found` }
  }

  try {
    el.domNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(100)
    ;(el.domNode as HTMLElement).focus()

    const name = el.accessibleName.trim() || el.htmlTag
    return { success: true, message: `✅ Focused [${index}] <${el.htmlTag}> "${name}"` }
  } catch (error) {
    return { success: false, message: `❌ Failed to focus [${index}]: ${error}` }
  }
}

// ─── Check/Uncheck ───
export async function toggleCheck(index: number, value?: boolean): Promise<ActionResult> {
  const el = getElementByIndex(index)
  if (!el?.domNode) {
    return { success: false, message: `Element [${index}] not found` }
  }

  try {
    const domNode = el.domNode as HTMLInputElement
    domNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(200)
    domNode.focus()

    const currentValue = domNode.checked
    const targetValue = value !== undefined ? value : !currentValue

    if (currentValue !== targetValue) {
      domNode.click()
    }

    const name = el.accessibleName.trim() || el.htmlTag
    return {
      success: true,
      message: `✅ ${targetValue ? 'Checked' : 'Unchecked'} [${index}] <${el.htmlTag}> "${name}"`,
    }
  } catch (error) {
    return { success: false, message: `❌ Failed to toggle [${index}]: ${error}` }
  }
}

// ─── Utility ───
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Extract JSON from LLM response ───
export function extractJson(text: string): string {
  // Already valid JSON
  try {
    JSON.parse(text)
    return text
  } catch {}

  // Try markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      JSON.parse(codeBlockMatch[1].trim())
      return codeBlockMatch[1].trim()
    } catch {}
  }

  // Try to find JSON object in text
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      JSON.parse(jsonMatch[0])
      return jsonMatch[0]
    } catch {}
  }

  // Return as-is
  return text
}
