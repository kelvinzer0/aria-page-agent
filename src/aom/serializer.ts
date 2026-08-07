/**
 * Semantic Serializer
 *
 * Converts the AOM tree into an LLM-friendly text format.
 * This is the KEY differentiator from page-agent:
 * - Includes ARIA roles and accessible names
 * - Shows semantic relationships (label ↔ input, table headers ↔ cells)
 * - Marks interactive elements with indices for actions
 * - Shows element state (checked, expanded, disabled, etc.)
 * - Includes landmark structure for page orientation
 * - Reports accessibility issues inline
 */

import type { AomElement, AomIssue } from './types'

export interface SerializedBrowserState {
  url: string
  title: string
  header: string
  content: string
  footer: string
  issues: string
  landmarks: string
  dialogs: string
}

// ─── Element State String ───
function stateString(el: AomElement): string {
  const states: string[] = []
  const a = el.attributes

  if (a.ariaChecked === 'true') states.push('✓checked')
  else if (a.ariaChecked === 'false') states.push('☐unchecked')
  else if (a.ariaChecked === 'mixed') states.push('◐mixed')

  if (a.ariaExpanded === true) states.push('▼expanded')
  else if (a.ariaExpanded === false) states.push('▶collapsed')

  if (a.ariaDisabled || a.htmlDisabled) states.push('⊘disabled')
  if (a.ariaSelected) states.push('●selected')
  if (a.ariaPressed === 'true') states.push('⌫pressed')
  if (a.ariaInvalid) states.push('⚠invalid')
  if (a.ariaRequired) states.push('*required')
  if (a.ariaModal) states.push('🔒modal')
  if (a.ariaHasPopup) states.push('▾has-popup')
  if (a.ariaMultiline) states.push('¶multiline')

  // Value
  if (a.ariaValueNow !== undefined) {
    let val = `${a.ariaValueNow}`
    if (a.ariaValueMin !== undefined) val += `/${a.ariaValueMin}-${a.ariaValueMax}`
    states.push(`value:${val}`)
  }
  if (a.ariaValueText) states.push(`"${a.ariaValueText}"`)

  // Position in set
  if (a.ariaPosInSet !== undefined && a.ariaSetSize !== undefined) {
    states.push(`[${a.ariaPosInSet}/${a.ariaSetSize}]`)
  }

  return states.length > 0 ? ` {${states.join(' ')}}` : ''
}

// ─── Role Display Name ───
function roleDisplay(role: string | null): string {
  if (!role) return ''
  const roleMap: Record<string, string> = {
    'heading': '#', 'link': '→', 'button': '🔘', 'textbox': '📝',
    'checkbox': '☐', 'radio': '◉', 'combobox': '📋', 'listbox': '📋',
    'img': '🖼', 'table': '📊', 'list': '☰', 'listitem': '•',
    'navigation': '🧭', 'main': '📄', 'banner': '🏠', 'contentinfo': 'ℹ',
    'search': '🔍', 'form': '📋', 'dialog': '💬', 'alert': '🔔',
    'tab': '📑', 'tabpanel': '📄', 'switch': '🔀', 'slider': '🎚',
    'progressbar': '⏳', 'separator': '─', 'menu': '📋', 'menuitem': '•',
    'toolbar': '🔧', 'tooltip': '💬', 'status': '📊', 'log': '📜',
    'region': '📦', 'article': '📰', 'figure': '🖼', 'complementary': '📎',
    'term': '📖', 'definition': '📖', 'group': '📁', 'none': '',
    'presentation': '', 'generic': '',
  }
  return roleMap[role] || `[${role}]`
}

// ─── Heading Level ───
function headingLevel(el: AomElement): number | undefined {
  if (el.role !== 'heading') return undefined
  // From htmlTag
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(el.htmlTag)) {
    return parseInt(el.htmlTag[1])
  }
  // From aria-level
  return el.attributes.ariaRowIndex || undefined
}

// ─── Render Single Element ───
function renderElement(el: AomElement, depth: number): string {
  if (el.isHidden) return ''
  if (!el.hasContent && !el.isInteractive) return ''

  const indent = '  '.repeat(depth)
  const parts: string[] = []

  // Interactive index
  const idx = el.isInteractive && el.interactiveIndex !== null
    ? `[${el.interactiveIndex}]`
    : ''

  // Role display
  const role = roleDisplay(el.role)

  // Heading level prefix
  const hLevel = headingLevel(el)
  const hPrefix = hLevel ? `${'#'.repeat(hLevel)} ` : ''

  // Accessible name
  const name = el.accessibleName.trim()

  // State
  const state = stateString(el)

  // Relations info
  const relInfo = relationInfo(el)

  // Build the line
  if (idx || role || name || state) {
    let line = `${indent}`

    if (idx) line += `${idx}`

    // Special formatting for headings
    if (hLevel) {
      line += `${role} ${hPrefix}${name}${state}`
    }
    // Links with href
    else if (el.role === 'link' && el.attributes.htmlHref) {
      line += `${role} ${name} → ${el.attributes.htmlHref}${state}`
    }
    // Images with src
    else if ((el.role === 'img' || el.htmlTag === 'img') && el.attributes.htmlSrc) {
      line += `${role} ${name || '(no alt)'}${state}`
    }
    // Tables - show dimensions
    else if (el.role === 'table' && el.tableContext) {
      const tc = el.tableContext
      line += `${role} ${name} (${tc.rowCount}×${tc.colCount})${state}`
    }
    // Generic
    else {
      line += `${role} ${name}${state}`
    }

    if (relInfo) line += ` ${relInfo}`
    parts.push(line)
  }

  // Table cell context
  if (el.tableContext) {
    const cellInfo = el.tableContext.cells.get(el)
    if (cellInfo) {
      const rowHeaders = cellInfo.rowHeaders.map(h => h.accessibleName).filter(Boolean).join(', ')
      const colHeaders = cellInfo.colHeaders.map(h => h.accessibleName).filter(Boolean).join(', ')
      if (rowHeaders || colHeaders) {
        const ctx = []
        if (colHeaders) ctx.push(`column: ${colHeaders}`)
        if (rowHeaders) ctx.push(`row: ${rowHeaders}`)
        parts.push(`${indent}  └ context: ${ctx.join(', ')}`)
      }
    }
  }

  // Children
  for (const child of el.children) {
    const childStr = renderElement(child, depth + 1)
    if (childStr) parts.push(childStr)
  }

  return parts.join('\n')
}

// ─── Relation Info ───
function relationInfo(el: AomElement): string {
  const rels: string[] = []

  if (el.relations.labelledBy.length > 0) {
    const labels = el.relations.labelledBy.map(l => l.accessibleName).filter(Boolean)
    if (labels.length) rels.push(`labelled-by:"${labels.join(' ')}"`)
  }

  if (el.relations.describedBy.length > 0) {
    const descs = el.relations.describedBy.map(d => d.accessibleName).filter(Boolean)
    if (descs.length) rels.push(`described-by:"${descs.join(' ')}"`)
  }

  if (el.relations.controls.length > 0) {
    rels.push(`controls:${el.relations.controls.length}`)
  }

  if (el.relations.owns.length > 0) {
    rels.push(`owns:${el.relations.owns.length}`)
  }

  return rels.length > 0 ? `(${rels.join(', ')})` : ''
}

// ─── Collect Landmarks ───
function collectLandmarks(el: AomElement, result: string[] = [], depth = 0): string[] {
  const landmarkRoles = new Set([
    'banner', 'complementary', 'contentinfo', 'form', 'main',
    'navigation', 'region', 'search',
  ])

  if (el.role && landmarkRoles.has(el.role)) {
    const name = el.accessibleName.trim()
    const label = name ? ` "${name}"` : ''
    result.push(`${'  '.repeat(depth)}${roleDisplay(el.role)} ${el.role}${label}`)
  }

  for (const child of el.children) {
    if (!child.isHidden) collectLandmarks(child, result, depth + 1)
  }

  return result
}

// ─── Collect Issues ───
function formatIssues(issues: AomIssue[]): string {
  if (issues.length === 0) return 'No accessibility issues detected.'

  const bySeverity = {
    error: issues.filter(i => i.severity === 'error'),
    warning: issues.filter(i => i.severity === 'warning'),
    info: issues.filter(i => i.severity === 'info'),
  }

  const lines: string[] = []

  if (bySeverity.error.length > 0) {
    lines.push(`❌ Errors (${bySeverity.error.length}):`)
    bySeverity.error.slice(0, 10).forEach(i => {
      const name = i.element.accessibleName.trim() || i.element.htmlTag
      lines.push(`  - ${i.message}: <${i.element.htmlTag}> "${name}"`)
    })
  }

  if (bySeverity.warning.length > 0) {
    lines.push(`⚠️ Warnings (${bySeverity.warning.length}):`)
    bySeverity.warning.slice(0, 5).forEach(i => {
      const name = i.element.accessibleName.trim() || i.element.htmlTag
      lines.push(`  - ${i.message}: <${i.element.htmlTag}> "${name}"`)
    })
  }

  return lines.join('\n')
}

// ─── Main Serialization ───
export function serializeToBrowserState(
  root: AomElement,
  issues: AomIssue[],
  recentDialogs?: Array<{ type: string; message: string; timestamp: number }>
): SerializedBrowserState {
  const url = window.location.href
  const title = document.title

  // Page dimensions
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
  const scrollY = window.scrollY
  const pagesAbove = viewportH > 0 ? scrollY / viewportH : 0
  const pagesBelow = viewportH > 0 ? (pageH - viewportH - scrollY) / viewportH : 0

  const header = [
    `Current Page: [${title}](${url})`,
    `Page info: ${viewportW}×${viewportH}px viewport, page height ${pageH}px, ${pagesAbove.toFixed(1)} pages above, ${pagesBelow.toFixed(1)} pages below`,
    '',
    '## Accessibility Object Model',
    'Elements shown as: [index] role name {state}',
    'Roles: →=link 🔘=button 📝=input ☐=checkbox ◉=radio 🖼=image 📊=table',
    '',
  ].join('\n')

  // Render content tree
  const contentParts: string[] = []
  for (const child of root.children) {
    if (child.isHidden) continue
    const rendered = renderElement(child, 0)
    if (rendered) contentParts.push(rendered)
  }
  const content = contentParts.join('\n')

  // Scroll hints
  const hasAbove = scrollY > 4
  const hasBelow = (pageH - viewportH - scrollY) > 4
  const footer = [
    hasAbove ? `... ${(scrollY).toFixed(0)}px above (${pagesAbove.toFixed(1)} pages) - scroll up to see more ...` : '[Start of page]',
    hasBelow ? `... ${(pageH - viewportH - scrollY).toFixed(0)}px below (${pagesBelow.toFixed(1)} pages) - scroll down to see more ...` : '[End of page]',
  ].join('\n')

  // Landmarks
  const landmarks = collectLandmarks(root)
  const landmarksStr = landmarks.length > 0
    ? landmarks.join('\n')
    : 'No landmarks found.'

  // Issues
  const issuesStr = formatIssues(issues)

  // Format recent dialogs
  const dialogsStr = recentDialogs && recentDialogs.length > 0
    ? recentDialogs.map(d => {
        const time = new Date(d.timestamp).toLocaleTimeString()
        const icon = d.type === 'alert' ? '🔔' : d.type === 'confirm' ? '❓' : d.type === 'prompt' ? '💬' : '⚠️'
        return `${icon} [${time}] ${d.type}: ${d.message}`
      }).join('\n')
    : 'No recent dialogs'

  return { url, title, header, content, footer, issues: issuesStr, landmarks: landmarksStr, dialogs: dialogsStr }
}
