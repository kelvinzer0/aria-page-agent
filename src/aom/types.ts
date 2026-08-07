/**
 * ARIA Accessibility Object Model - Type Definitions
 *
 * Ported from aria-devtools with enhancements for LLM agent consumption.
 * No MobX dependency - pure TypeScript for content script injection.
 */

// ─── ARIA Role ───
export type AriaRole =
  | 'alert' | 'application' | 'article' | 'banner' | 'button'
  | 'checkbox' | 'combobox' | 'complementary' | 'contentinfo'
  | 'dialog' | 'document' | 'feed' | 'figure' | 'form'
  | 'grid' | 'heading' | 'img' | 'link' | 'list' | 'listbox'
  | 'listitem' | 'main' | 'navigation' | 'none' | 'option'
  | 'paragraph' | 'presentation' | 'radio' | 'radiogroup'
  | 'region' | 'row' | 'rowgroup' | 'search' | 'separator'
  | 'switch' | 'tab' | 'table' | 'tablist' | 'tabpanel'
  | 'term' | 'textbox' | 'timer' | 'toolbar' | 'tooltip'
  | 'tree' | 'treegrid' | 'treeitem'
  | 'columnheader' | 'rowheader' | 'cell' | 'gridcell'
  | 'spinbutton' | 'scrollbar' | 'status' | 'progressbar'
  | 'menubar' | 'menu' | 'menuitem' | 'menuitemcheckbox' | 'menuitemradio'
  | 'math' | 'note' | 'definition' | 'directory'
  | 'group' | 'generic' | 'log' | 'marquee' | 'meter'
  | 'text' | null

// ─── Core AOM Element ───
export interface AomElement {
  key: string
  role: AriaRole
  domNode: HTMLElement | null
  htmlTag: string

  // Computed accessible name (W3C accname spec)
  accessibleName: string
  description: string

  // State
  isHidden: boolean
  isFocused: boolean
  isInteractive: boolean
  hasContent: boolean

  // Hierarchy
  htmlParent: AomElement | null
  children: AomElement[]

  // Relations
  relations: AomRelations

  // Raw ARIA attributes
  attributes: AriaAttributes

  // Table context (if applicable)
  tableContext: TableContext | null

  // Issues detected
  issues: AomIssue[]

  // Interactive element index (for LLM actions)
  interactiveIndex: number | null

  // Position & visibility
  isInViewport: boolean
  boundingRect: DOMRect | null
}

// ─── ARIA Attributes (computed) ───
export interface AriaAttributes {
  // Identity
  id?: string
  role?: AriaRole

  // Labeling
  ariaLabel?: string
  ariaLabelledBy: string[]
  ariaDescribedBy: string[]
  ariaDescription?: string

  // State
  ariaChecked?: 'true' | 'false' | 'mixed'
  ariaDisabled?: boolean
  ariaExpanded?: boolean
  ariaHidden?: boolean
  ariaInvalid?: boolean
  ariaPressed?: 'true' | 'false' | 'mixed'
  ariaSelected?: boolean
  ariaModal?: boolean
  ariaRequired?: boolean
  ariaMultiline?: boolean
  ariaHasPopup?: boolean | string

  // Value
  ariaValueMin?: number
  ariaValueMax?: number
  ariaValueNow?: number
  ariaValueText?: string

  // Position in set
  ariaSetSize?: number
  ariaPosInSet?: number

  // Table
  ariaRowIndex?: number
  ariaColIndex?: number
  ariaRowSpan?: number
  ariaColSpan?: number
  ariaSort?: 'ascending' | 'descending' | 'none' | 'other'

  // Live region
  ariaLive?: 'off' | 'polite' | 'assertive'
  ariaAtomic?: boolean
  ariaRelevant?: string

  // Relationship
  ariaOwns: string[]
  ariaControls: string[]
  ariaActiveDescendant?: string

  // Orientation
  ariaOrientation?: 'horizontal' | 'vertical'

  // HTML native attributes
  htmlAlt?: string
  htmlTitle?: string
  htmlPlaceholder?: string
  htmlHref?: string
  htmlSrc?: string
  htmlType?: string
  htmlName?: string
  htmlValue?: string
  htmlFor?: string
  htmlChecked?: boolean
  htmlDisabled?: boolean
  htmlRequired?: boolean
  htmlTabIndex?: number
}

// ─── Relations ───
export interface AomRelations {
  labelledBy: AomElement[]
  describedBy: AomElement[]
  owns: AomElement[]
  controls: AomElement[]
  activeDescendant: AomElement | null
  ownedBy: AomElement[]
  controlledBy: AomElement[]
  labelOf: AomElement[]
  describedOf: AomElement[]
}

// ─── Table Context ───
export interface TableCell {
  rowIndex: number
  colIndex: number
  rowSpan: number
  colSpan: number
  rowHeaders: AomElement[]
  colHeaders: AomElement[]
}

export interface TableContext {
  rows: AomElement[][][]
  cells: Map<AomElement, TableCell>
  rowCount: number
  colCount: number
}

// ─── Issues ───
export interface AomIssue {
  type: 'missing_label' | 'missing_alt' | 'wrong_role' | 'missing_heading' | 'empty_heading'
       | 'missing_form_label' | 'low_contrast' | 'missing_landmark' | 'invalid_role'
       | 'interactive_no_name' | 'image_no_alt' | 'link_no_name' | 'button_no_name'
       | 'heading_hierarchy_skip' | 'table_no_headers' | 'aria_live_missing'
  severity: 'error' | 'warning' | 'info'
  message: string
  element: AomElement
}
