/**
 * AOM Traverse Engine
 *
 * Recursively traverses DOM and builds the Accessibility Object Model.
 * This is the core engine that gives the agent "screen reader eyes".
 *
 * Ported from aria-devtools with enhancements:
 * - No MobX dependency (pure functions)
 * - Interactive element indexing for LLM actions
 * - Viewport awareness
 * - Bounding rect tracking
 */

import type { AomElement, AriaAttributes, AriaRole, AomRelations, TableContext, TableCell, AomIssue } from './types'

const IGNORED_TAGS = new Set(['script', 'noscript', 'style', 'link', 'meta', 'head'])

let interactiveCounter = 0
let issueList: AomIssue[] = []

// ─── Key generation ───
let keyCounter = 0
function generateKey(node: Node): string {
  const existing = (node as any).__aomKey
  if (existing) return existing
  const key = `aom_${keyCounter++}`
  ;(node as any).__aomKey = key
  return key
}

// ─── Utilities ───
function isHidden(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true
  if (el.hasAttribute('hidden')) return true
  if ((el as HTMLInputElement).type === 'hidden') return true
  const style = getComputedStyle(el)
  if (style.display === 'none') return true
  if (style.visibility === 'hidden') return true
  // Check parents
  let parent: HTMLElement | null = el.parentElement
  while (parent) {
    if (parent.getAttribute('aria-hidden') === 'true') return true
    const parentStyle = getComputedStyle(parent)
    if (parentStyle.display === 'none') return true
    parent = parent.parentElement
  }
  return false
}

function isInViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw
}

function isInteractiveElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  const interactiveTags = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'details', 'summary',
    'label', 'option', 'optgroup',
  ])
  if (interactiveTags.has(tag)) return true
  if (el.hasAttribute('tabindex')) return true
  if (el.getAttribute('role') === 'button') return true
  if (el.isContentEditable) return true
  // Check for click handlers (heuristic)
  const role = el.getAttribute('role')
  const interactiveRoles = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
    'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'switch', 'tab', 'treeitem', 'slider', 'spinbutton',
    'scrollbar', 'searchbox',
  ])
  return role ? interactiveRoles.has(role) : false
}

function hasEmptyRoleMapping(tag: string): boolean {
  const emptyTags = new Set([
    'div', 'span', 'p', 'br', 'hr', 'pre', 'blockquote', 'figure',
    'figcaption', 'abbr', 'time', 'code', 'em', 'strong', 'small',
    'sub', 'sup', 'mark', 'ruby', 'rt', 'rp', 'bdi', 'bdo', 'wbr',
    'img', 'picture', 'source', 'map', 'area', 'audio', 'video',
    'track', 'embed', 'object', 'param', 'iframe', 'canvas',
    'template', 'slot', 'datalist', 'output', 'progress', 'meter',
  ])
  return emptyTags.has(tag)
}

function isRootLandmark(node: AomElement): boolean {
  if (!node.htmlParent) return true
  const parentTag = node.htmlParent.htmlTag
  // header/footer are landmarks only when not nested in article, section, aside, nav, main
  const sectioningTags = new Set(['article', 'section', 'aside', 'nav', 'main'])
  return !sectioningTags.has(parentTag)
}

// ─── Attribute reading ───
function readAttributes(el: HTMLElement): AriaAttributes {
  const g = (attr: string) => el.getAttribute(attr)?.trim()
  const gBool = (attr: string) => el.getAttribute(attr) === 'true'
  const gNum = (attr: string) => {
    const v = el.getAttribute(attr)?.trim()
    return v ? parseInt(v, 10) : undefined
  }
  const gIdList = (attr: string): string[] => {
    const v = g(attr)
    return v ? v.split(/\s+/).filter(Boolean) : []
  }

  return {
    id: g('id'),
    role: g('role') as AriaRole || undefined,
    ariaLabel: g('aria-label'),
    ariaLabelledBy: gIdList('aria-labelledby'),
    ariaDescribedBy: gIdList('aria-describedby'),
    ariaDescription: g('aria-description'),
    ariaChecked: (g('aria-checked') as any) || undefined,
    ariaDisabled: gBool('aria-disabled') || (el as HTMLInputElement).disabled || undefined,
    ariaExpanded: g('aria-expanded') === 'true' ? true : g('aria-expanded') === 'false' ? false : undefined,
    ariaHidden: gBool('aria-hidden') || undefined,
    ariaInvalid: gBool('aria-invalid') || !(el as HTMLInputElement).validity?.valid || undefined,
    ariaPressed: (g('aria-pressed') as any) || undefined,
    ariaSelected: gBool('aria-selected') || undefined,
    ariaModal: gBool('aria-modal') || undefined,
    ariaRequired: gBool('aria-required') || (el as HTMLInputElement).required || undefined,
    ariaMultiline: gBool('aria-multiline') || undefined,
    ariaHasPopup: g('aria-haspopup') || undefined,
    ariaValueMin: gNum('aria-valuemin'),
    ariaValueMax: gNum('aria-valuemax'),
    ariaValueNow: gNum('aria-valuenow'),
    ariaValueText: g('aria-valuetext'),
    ariaSetSize: gNum('aria-setsize'),
    ariaPosInSet: gNum('aria-posinset'),
    ariaRowIndex: gNum('aria-rowindex'),
    ariaColIndex: gNum('aria-colindex'),
    ariaRowSpan: gNum('aria-rowspan'),
    ariaColSpan: gNum('aria-colspan'),
    ariaSort: (g('aria-sort') as any) || undefined,
    ariaLive: (g('aria-live') as any) || undefined,
    ariaAtomic: gBool('aria-atomic') || undefined,
    ariaRelevant: g('aria-relevant'),
    ariaOwns: gIdList('aria-owns'),
    ariaControls: gIdList('aria-controls'),
    ariaActiveDescendant: g('aria-activedescendant'),
    ariaOrientation: (g('aria-orientation') as any) || undefined,
    htmlAlt: g('alt'),
    htmlTitle: g('title'),
    htmlPlaceholder: g('placeholder'),
    htmlHref: g('href') || undefined,
    htmlSrc: g('src'),
    htmlType: (el as HTMLInputElement).type || g('type'),
    htmlName: (el as HTMLInputElement).name || g('name'),
    htmlValue: (el as HTMLInputElement).value || undefined,
    htmlFor: el.tagName.toLowerCase() === 'label' ? g('for') : undefined,
    htmlChecked: (el as HTMLInputElement).checked || undefined,
    htmlDisabled: (el as HTMLInputElement).disabled || undefined,
    htmlRequired: (el as HTMLInputElement).required || undefined,
    htmlTabIndex: el.tabIndex,
  }
}

// ─── ARIA Role Mapping (HTML AAM) ───
function computeMappedRole(el: HTMLElement): { role: AriaRole; extra?: Partial<AriaAttributes> } | null {
  const tag = el.tagName.toLowerCase()
  const attrs = el.getAttribute('role')

  // Explicit role takes precedence
  if (attrs) {
    return { role: attrs.trim() as AriaRole }
  }

  if (hasEmptyRoleMapping(tag)) return null

  if (tag === 'main') return { role: 'main' }
  if (tag === 'nav') return { role: 'navigation' }
  if (tag === 'aside') return { role: 'complementary' }
  if (tag === 'header') return isRootLandmark({ htmlTag: tag } as any) ? { role: 'banner' } : null
  if (tag === 'footer') return isRootLandmark({ htmlTag: tag } as any) ? { role: 'contentinfo' } : null

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    return { role: 'heading', extra: { ariaRowIndex: undefined, ariaColIndex: undefined } }
  }

  if (tag === 'a' || tag === 'area') {
    return { role: el.hasAttribute('href') ? 'link' : null }
  }

  if (tag === 'ol' || tag === 'ul' || tag === 'menu') return { role: 'list' }

  if (tag === 'li') {
    const parent = el.parentElement
    if (parent && ['ol', 'ul', 'menu'].includes(parent.tagName.toLowerCase())) {
      return { role: 'listitem' }
    }
    return null
  }

  if (tag === 'img') {
    const alt = el.getAttribute('alt')
    return { role: alt?.trim() === '' ? 'presentation' : 'img' }
  }

  if (tag === 'form') {
    const label = el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')?.trim()
    return label ? { role: 'form' } : null
  }

  if (tag === 'fieldset') return { role: 'group' }

  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.trim()
    if (type === 'checkbox') return { role: 'checkbox' }
    if (type === 'radio') return { role: 'radio' }
    if (type === 'submit' || type === 'button' || type === 'reset') return { role: 'button' }
    if (type === 'number') return { role: 'spinbutton' }
    if (type === 'range') return { role: 'slider' }
    if (type === 'search') return { role: 'searchbox' }
    return { role: 'textbox' }
  }

  if (tag === 'textarea') return { role: 'textbox' }
  if (tag === 'button' || tag === 'summary') return { role: 'button' }
  if (tag === 'article') return { role: 'article' }
  if (tag === 'figure') return { role: 'figure' }
  if (tag === 'hr') return { role: 'separator' }
  if (tag === 'dialog') return { role: 'dialog' }

  if (tag === 'section') {
    const label = el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')?.trim()
    return label ? { role: 'region' } : null
  }

  if (tag === 'dd') return { role: 'definition' }
  if (tag === 'dt') return { role: 'term' }

  if (tag === 'select') {
    const isMultiple = el.hasAttribute('multiple')
    const size = parseInt(el.getAttribute('size') || '0')
    return { role: isMultiple || size > 1 ? 'listbox' : 'combobox' }
  }

  if (tag === 'optgroup') return { role: 'group' }
  if (tag === 'option') return { role: 'option' }
  if (tag === 'table') return { role: 'table' }
  if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') return { role: 'rowgroup' }
  if (tag === 'tr') return { role: 'row' }
  if (tag === 'td' || tag === 'th') return { role: tag === 'th' ? 'columnheader' : 'cell' }

  if (tag === 'svg') return { role: 'img' }

  return null
}

// ─── Accessible Name Computation (W3C accname) ───
function computeAccessibleName(element: AomElement): string {
  // Guard against recursion
  if ((element as any).__computingName) return ''
  ;(element as any).__computingName = true

  try {
    if (element.isHidden) return ''

    const attrs = element.attributes

    // 1. aria-labelledby
    if (attrs.ariaLabelledBy.length > 0) {
      const names = attrs.ariaLabelledBy
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(el => el!.textContent?.trim() || '')
        .filter(Boolean)
      if (names.length > 0) return names.join(' ')
    }

    // 2. aria-label
    if (attrs.ariaLabel?.trim()) return attrs.ariaLabel.trim()

    // 3. Label element (for=)
    if (attrs.htmlFor) {
      const label = document.querySelector(`label[for="${attrs.htmlFor}"]`)
      if (label) {
        const text = label.textContent?.trim()
        if (text) return text
      }
    }

    // 4. Parent label
    if (element.htmlParent?.htmlTag === 'label') {
      const text = element.htmlParent.accessibleName
      if (text) return text
    }

    // 5. Legend (fieldset)
    if (element.htmlParent?.htmlTag === 'fieldset') {
      const legend = element.htmlParent.children.find(c => c.htmlTag === 'legend')
      if (legend) {
        const text = legend.accessibleName
        if (text) return text
      }
    }

    // 6. alt for images
    const isPresentation = element.role === 'none' || element.role === 'presentation'
    if (element.htmlTag === 'img' && !isPresentation && attrs.htmlAlt != null) {
      return attrs.htmlAlt
    }

    // 7. title attribute
    if (!isPresentation && attrs.htmlTitle) return attrs.htmlTitle

    // 8. placeholder
    if (attrs.htmlPlaceholder) return attrs.htmlPlaceholder

    // 9. Input value for buttons
    if (element.htmlTag === 'input' && attrs.htmlType && attrs.htmlValue) {
      if (['submit', 'button', 'reset'].includes(attrs.htmlType)) {
        return attrs.htmlValue
      }
    }

    // 10. Children text
    const childTexts = element.children
      .map(c => c.accessibleName)
      .filter(Boolean)
    if (childTexts.length > 0) return childTexts.join(' ')

    // 11. Text content (for text nodes and leaf elements)
    if (element.domNode) {
      const text = element.domNode.textContent?.trim()
      if (text && text.length < 300) return text
    }

    return ''
  } finally {
    delete (element as any).__computingName
  }
}

// ─── Description Computation ───
function computeDescription(element: AomElement): string {
  const attrs = element.attributes

  if (attrs.ariaDescribedBy.length > 0) {
    const descs = attrs.ariaDescribedBy
      .map(id => document.getElementById(id))
      .filter(Boolean)
      .map(el => el!.textContent?.trim() || '')
      .filter(Boolean)
    if (descs.length > 0) return descs.join(' ')
  }

  if (attrs.ariaDescription?.trim()) return attrs.ariaDescription.trim()

  return ''
}

// ─── Issues Detection ───
function detectIssues(element: AomElement): AomIssue[] {
  const issues: AomIssue[] = []
  const attrs = element.attributes

  // Interactive elements must have accessible name
  if (element.isInteractive && !element.accessibleName.trim()) {
    if (element.htmlTag === 'button' || element.role === 'button') {
      issues.push({ type: 'button_no_name', severity: 'error', message: 'Button has no accessible name', element })
    } else if (element.htmlTag === 'a' || element.role === 'link') {
      issues.push({ type: 'link_no_name', severity: 'error', message: 'Link has no accessible name', element })
    } else {
      issues.push({ type: 'interactive_no_name', severity: 'error', message: 'Interactive element has no accessible name', element })
    }
  }

  // Images need alt text
  if (element.htmlTag === 'img' && element.role !== 'presentation' && element.role !== 'none') {
    if (attrs.htmlAlt === undefined) {
      issues.push({ type: 'image_no_alt', severity: 'error', message: 'Image missing alt attribute', element })
    }
  }

  // Form inputs need labels
  if (['input', 'select', 'textarea'].includes(element.htmlTag) && !element.accessibleName.trim()) {
    if (attrs.htmlType !== 'hidden' && attrs.htmlType !== 'submit' && attrs.htmlType !== 'button') {
      issues.push({ type: 'missing_form_label', severity: 'error', message: 'Form control has no associated label', element })
    }
  }

  // Headings should have text
  if (element.role === 'heading' && !element.accessibleName.trim()) {
    issues.push({ type: 'empty_heading', severity: 'warning', message: 'Heading has no text content', element })
  }

  return issues
}

// ─── Table Context ───
function buildTableContext(root: AomElement): TableContext | null {
  if (root.role !== 'table' && root.role !== 'grid' && root.htmlTag !== 'table') return null

  const rows: AomElement[][] = []
  const cells = new Map<AomElement, TableCell>()

  const findRows = (node: AomElement): AomElement[] => {
    const result: AomElement[] = []
    if (node.role === 'row' || node.htmlTag === 'tr') {
      result.push(node)
    }
    for (const child of node.children) {
      result.push(...findRows(child))
    }
    return result
  }

  const findCells = (node: AomElement): AomElement[] => {
    const result: AomElement[] = []
    const cellRoles = new Set(['cell', 'gridcell', 'columnheader', 'rowheader'])
    if (cellRoles.has(node.role || '') || node.htmlTag === 'td' || node.htmlTag === 'th') {
      result.push(node)
    }
    for (const child of node.children) {
      result.push(...findCells(child))
    }
    return result
  }

  const rowNodes = findRows(root)
  rowNodes.forEach((rowNode, rowIndex) => {
    const cellNodes = findCells(rowNode)
    rows[rowIndex] = rows[rowIndex] || []
    let colIndex = 0

    cellNodes.forEach(cell => {
      // Find next free column
      while (rows[rowIndex][colIndex]) colIndex++

      const rowSpan = cell.attributes.ariaRowSpan || 1
      const colSpan = cell.attributes.ariaColSpan || 1

      for (let i = 0; i < rowSpan; i++) {
        for (let j = 0; j < colSpan; j++) {
          if (!rows[rowIndex + i]) rows[rowIndex + i] = []
          rows[rowIndex + i][colIndex + j] = cell
        }
      }

      cells.set(cell, {
        rowIndex,
        colIndex,
        rowSpan,
        colSpan,
        rowHeaders: [],
        colHeaders: [],
      })
    })
  })

  return { rows, cells, rowCount: rows.length, colCount: rows.reduce((max, r) => Math.max(max, r?.length || 0), 0) }
}

// ─── CSS Content Extraction ───
function getCssContent(el: HTMLElement): { before: string; after: string } {
  try {
    const before = getComputedStyle(el, '::before').getPropertyValue('content')
    const after = getComputedStyle(el, '::after').getPropertyValue('content')
    const clean = (s: string) => {
      if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
      if (s === 'none') return ''
      return ''
    }
    return { before: clean(before), after: clean(after) }
  } catch {
    return { before: '', after: '' }
  }
}

// ─── Main Traverse Function ───
export function resetTraverse() {
  interactiveCounter = 0
  issueList = []
  keyCounter = 0
}

export function traverse(
  htmlNode: Node | null | undefined,
  traversedNodes: Map<Node, AomElement> = new Map()
): AomElement | null {
  if (!htmlNode) return null
  if (traversedNodes.has(htmlNode)) {
    return traversedNodes.get(htmlNode)!
  }

  // Text node
  if (htmlNode.nodeType === Node.TEXT_NODE) {
    const text = htmlNode.textContent
    if (!text?.trim()) return null

    const el: AomElement = {
      key: generateKey(htmlNode),
      role: 'text',
      domNode: htmlNode as HTMLElement,
      htmlTag: '#text',
      accessibleName: text.trim(),
      description: '',
      isHidden: false,
      isFocused: false,
      isInteractive: false,
      hasContent: text.trim().length > 0,
      htmlParent: null,
      children: [],
      relations: emptyRelations(),
      attributes: emptyAttributes(),
      tableContext: null,
      issues: [],
      interactiveIndex: null,
      isInViewport: false,
      boundingRect: null,
    }

    traversedNodes.set(htmlNode, el)
    return el
  }

  // Skip non-element nodes
  if (htmlNode.nodeType !== Node.ELEMENT_NODE) return null

  const htmlEl = htmlNode as HTMLElement
  const tag = htmlEl.tagName.toLowerCase()

  // Skip ignored elements
  if (IGNORED_TAGS.has(tag)) return null

  // Build element
  const attributes = readAttributes(htmlEl)
  const mapped = computeMappedRole(htmlEl)
  const role = (attributes.role || mapped?.role || null) as AriaRole
  const hidden = isHidden(htmlEl)
  const interactive = !hidden && isInteractiveElement(htmlEl)
  const rect = !hidden ? htmlEl.getBoundingClientRect() : null

  const el: AomElement = {
    key: generateKey(htmlNode),
    role,
    domNode: htmlEl,
    htmlTag: tag,
    accessibleName: '', // computed below
    description: '',
    isHidden: hidden,
    isFocused: document.activeElement === htmlEl,
    isInteractive: interactive,
    hasContent: false,
    htmlParent: null,
    children: [],
    relations: emptyRelations(),
    attributes: { ...attributes, ...(mapped?.extra || {}) },
    tableContext: null,
    issues: [],
    interactiveIndex: interactive ? interactiveCounter++ : null,
    isInViewport: isInViewport(htmlEl),
    boundingRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, toJSON: () => '' } as DOMRect : null,
  }

  // Traverse children (including shadow DOM)
  const childNodes = htmlEl.shadowRoot ? htmlEl.shadowRoot.childNodes : htmlNode.childNodes
  childNodes.forEach(child => {
    const childEl = traverse(child, traversedNodes)
    if (childEl) {
      childEl.htmlParent = el
      el.children.push(childEl)
    }
  })

  // CSS ::before / ::after content
  const cssContent = getCssContent(htmlEl)
  if (cssContent.before) {
    const textEl: AomElement = {
      key: el.key + '::before',
      role: 'text',
      domNode: null,
      htmlTag: '#css-before',
      accessibleName: cssContent.before,
      description: '',
      isHidden: false,
      isFocused: false,
      isInteractive: false,
      hasContent: true,
      htmlParent: el,
      children: [],
      relations: emptyRelations(),
      attributes: emptyAttributes(),
      tableContext: null,
      issues: [],
      interactiveIndex: null,
      isInViewport: el.isInViewport,
      boundingRect: null,
    }
    el.children.unshift(textEl)
  }
  if (cssContent.after) {
    const textEl: AomElement = {
      key: el.key + '::after',
      role: 'text',
      domNode: null,
      htmlTag: '#css-after',
      accessibleName: cssContent.after,
      description: '',
      isHidden: false,
      isFocused: false,
      isInteractive: false,
      hasContent: true,
      htmlParent: el,
      children: [],
      relations: emptyRelations(),
      attributes: emptyAttributes(),
      tableContext: null,
      issues: [],
      interactiveIndex: null,
      isInViewport: el.isInViewport,
      boundingRect: null,
    }
    el.children.push(textEl)
  }

  // Compute accessible name & description
  el.accessibleName = computeAccessibleName(el)
  el.description = computeDescription(el)
  el.hasContent = !hidden && (el.isInteractive || el.accessibleName.trim() !== '' || el.children.some(c => c.hasContent))

  // Build table context
  el.tableContext = buildTableContext(el)

  // Detect issues
  el.issues = detectIssues(el)
  issueList.push(...el.issues)

  traversedNodes.set(htmlNode, el)
  return el
}

export function getAllIssues(): AomIssue[] {
  return issueList
}

// ─── Helpers ───
function emptyRelations(): AomRelations {
  return {
    labelledBy: [], describedBy: [], owns: [], controls: [],
    activeDescendant: null, ownedBy: [], controlledBy: [],
    labelOf: [], describedOf: [],
  }
}

function emptyAttributes(): AriaAttributes {
  return {
    ariaLabelledBy: [], ariaDescribedBy: [], ariaOwns: [], ariaControls: [],
  }
}
