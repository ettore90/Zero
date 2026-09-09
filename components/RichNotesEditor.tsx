import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TOP_BLOCK_SELECTOR,
  createBlock,
  currentBlock,
  currentTopBlock,
  ensurePlaceholder,
  exitList,
  getCaretOffset,
  getOffsetWithin,
  insertBlock,
  insertInline,
  insertLineBreak,
  insertNewlineInPre,
  isEmptyBlock,
  normalizeBlocks,
  placeCaret,
  rangeForOffsets,
  renameBlock,
  renameList,
  setCaretOffset,
  splitBlock,
  styleSelection,
  textAfterCaret,
  textBeforeCaret,
  trimTrailingBreaks,
  trimTrailingNewlines,
  unwrapList,
  wrapBlockAsListItem,
  type BlockTag,
} from './notes/blocks';
import {
  continueNoteRow,
  getNoteRowContext,
  isNoteContentEmpty,
  migrateNoteRows,
  unwrapNoteRow,
  updateTaskRowCompletion,
} from './notes/noteRows';
import {
  addTableColumn,
  addTableRow,
  createTable,
  getTableCellInfo,
  removeTable,
  removeTableColumn,
  removeTableRow,
  type TableCellInfo,
} from './notes/tables';
import { SlashMenu, useSlashMenu, type EditorApi, type MenuRow } from './notes/slashCommands';

export type RichNotesEditorProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  toolbarClassName?: string;
  autoFocus?: boolean;
  disabled?: boolean;
};

type ColorControl = 'text' | 'highlight';
type FontFamily = 'sans' | 'serif' | 'mono';
type FontSize = 'sm' | 'base' | 'lg';

// The canvas palette, so the editor stops being the one bright rectangle in a
// dark column: surfaces from CodeCanvas's root and header (#1e1e1e / #252526),
// borders from its hairline (#3e3e3e), selection from RightPanel's active row.
// Only the nebula stops that actually exist are used -- 200/300/400/700 are not
// in the Tailwind config and silently resolved to nothing before.
const CONTROL_BASE =
  'inline-flex h-7 items-center justify-center rounded-md border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45';
const CONTROL_IDLE =
  'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-[#3e3e3e] dark:bg-[#2d2d2e] dark:text-slate-300 dark:hover:bg-[#37373a]';
const CONTROL_ACTIVE = 'border-nebula-500 bg-nebula-500/10 text-nebula-900 dark:text-white';
const BUTTON_CLASS = `${CONTROL_BASE} ${CONTROL_IDLE}`;
const ICON_BUTTON_CLASS = `${CONTROL_BASE.replace('px-2', 'w-7')} ${CONTROL_IDLE}`;
const ACTIVE_BUTTON_CLASS = CONTROL_ACTIVE;
const SELECT_CLASS =
  'h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-1 focus:ring-nebula-500 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#3e3e3e] dark:bg-[#2d2d2e] dark:text-slate-300 dark:hover:bg-[#37373a]';
const GROUP_CLASS = 'flex items-center gap-1';
const DIVIDER_CLASS = 'mx-1 hidden h-5 w-px bg-slate-200 dark:bg-[#3e3e3e] sm:block';

const FONT_FAMILIES: Record<FontFamily, string> = {
  sans: "Inter, system-ui, sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  mono: "'JetBrains Mono', SFMono-Regular, Consolas, monospace",
};
const FONT_SIZES: Record<FontSize, string> = { sm: '0.8125rem', base: '0.9375rem', lg: '1.125rem' };

// Structural tags worth keeping on paste. Everything else is unwrapped rather
// than dropped, so the text survives even when the source markup does not.
const PASTE_ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI',
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'PRE', 'BLOCKQUOTE', 'A',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
]);

function exec(cmd: string, value?: string) {
  if (typeof document === 'undefined') return false;
  try {
    return document.execCommand(cmd, false, value);
  } catch {
    return false;
  }
}

function isCommandActive(command: string) {
  if (typeof document === 'undefined') return false;
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function saveSelection() {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0).cloneRange();
}

function restoreSelection(range: Range | null) {
  if (!range || typeof window === 'undefined') return;
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Pasted HTML arrives carrying the source's inline styles, classes, fonts and
// wrapper spans. Keep the structure, drop every attribute except a safe href.
function sanitizePastedHtml(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const strip = (parent: ParentNode) => {
    for (const child of Array.from(parent.children)) {
      strip(child);
      if (!PASTE_ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const isSafeHref =
          child.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:|#|\/)/i.test(attr.value.trim());
        if (!isSafeHref) child.removeAttribute(attr.name);
      }
    }
  };
  strip(template.content);
  return template.innerHTML;
}

/** Hydration: adopt whatever the previous editor (or an agent) wrote. */
function hydrateEditor(root: HTMLElement) {
  migrateNoteRows(root);
  normalizeBlocks(root);
}

function markBlank(root: HTMLElement) {
  const hasText = (root.textContent ?? '').replace(/\u00a0/g, ' ').trim().length > 0;
  const hasObjects = !!root.querySelector('img, table, hr, [data-note-type], [data-callout]');
  root.setAttribute('data-blank', String(!hasText && !hasObjects));
}

function currentBlockTag(root: HTMLElement): '' | 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'blockquote' | 'pre' {
  const leaf = currentBlock(root);
  if (!leaf) return '';
  if (leaf.tagName === 'LI') {
    const list = leaf.parentElement?.tagName.toLowerCase();
    return list === 'ol' ? 'ol' : 'ul';
  }
  const tag = leaf.tagName.toLowerCase();
  if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'blockquote' || tag === 'pre') return tag;
  return '';
}

export function RichNotesEditor({
  value,
  defaultValue = '',
  onChange,
  placeholder = 'Start writing…',
  className = '',
  editorClassName = '',
  toolbarClassName = '',
  autoFocus = false,
  disabled = false,
}: RichNotesEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [activeColorTarget, setActiveColorTarget] = useState<ColorControl>('text');
  const [activeFontFamily, setActiveFontFamily] = useState<FontFamily>('sans');
  const [activeFontSize, setActiveFontSize] = useState<FontSize>('base');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeMarks, setActiveMarks] = useState({ bold: false, italic: false, underline: false });
  const [activeBlock, setActiveBlock] = useState<ReturnType<typeof currentBlockTag>>('');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [tableToolbarPosition, setTableToolbarPosition] = useState({ top: 0, left: 0 });
  const [showTableToolbar, setShowTableToolbar] = useState(false);

  const selectionRef = useRef<Range | null>(null);
  // Held while Shift is down, so Shift+V pastes unformatted text.
  const plainPasteRef = useRef(false);
  const triggerRef = useRef<{ host: HTMLElement; start: number; end: number } | null>(null);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedValueRef = useRef<string>('');
  const isComposingRef = useRef(false);

  const slash = useSlashMenu();
  const htmlValue = value ?? internalValue;
  const isControlled = value !== undefined;

  const syncActiveState = useCallback(() => {
    const root = editorRef.current;
    setActiveBlock(root ? currentBlockTag(root) : '');
    setActiveMarks({
      bold: isCommandActive('bold'),
      italic: isCommandActive('italic'),
      underline: isCommandActive('underline'),
    });
  }, []);

  const emitChange = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    markBlank(root);
    const html = root.innerHTML;
    // Claim it as already synced. The DOM is this value's source, so the
    // controlled-value effect must not push it back and rebuild the editor --
    // that rebuild is what dropped line breaks, list structure and the caret.
    lastSyncedValueRef.current = html;
    if (!isControlled) setInternalValue(html);
    onChange?.(html);
    syncActiveState();
  }, [isControlled, onChange, syncActiveState]);

  const syncEditorContent = useCallback((nextHtml: string) => {
    const root = editorRef.current;
    if (!root || root.innerHTML === nextHtml) return;
    const hadFocus = root === document.activeElement || root.contains(document.activeElement);
    const caret = hadFocus ? getCaretOffset(root) : null;
    root.innerHTML = nextHtml;
    hydrateEditor(root);
    markBlank(root);
    if (caret !== null) setCaretOffset(root, caret);
  }, []);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    // Without this, the inline mark commands emit deprecated <font> tags that
    // neither the paste sanitizer nor the server's HTML surgery understands.
    exec('styleWithCSS', 'true');
    if (!root.innerHTML) root.innerHTML = htmlValue || '';
    hydrateEditor(root);
    markBlank(root);
    // Hydration rewrites the markup, so the DOM legitimately differs from the
    // incoming value. Claiming it as synced keeps the controlled effect from
    // undoing the migration, and leaves the note clean until the first edit.
    lastSyncedValueRef.current = htmlValue;
    if (autoFocus) {
      root.focus();
      const first = root.firstElementChild as HTMLElement | null;
      if (first) placeCaret(first, 'start');
    }
    syncActiveState();
    // Runs once: this is hydration, not a reaction to prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lastSyncedValueRef.current === htmlValue) return;
    lastSyncedValueRef.current = htmlValue;
    syncEditorContent(htmlValue);
  }, [htmlValue, syncEditorContent]);

  // A ClipboardEvent carries no modifier state, so Shift is tracked separately
  // to let Shift+V paste as unformatted text.
  useEffect(() => {
    const track = (event: KeyboardEvent) => {
      plainPasteRef.current = event.shiftKey;
    };
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
    };
  }, []);

  // --- block operations ------------------------------------------------------

  const applyBlockTag = useCallback((tag: BlockTag) => {
    const root = editorRef.current;
    if (!root) return;
    let leaf = currentBlock(root);
    if (!leaf) return;
    if (leaf.matches('p[data-note-type]')) {
      const paragraph = unwrapNoteRow(leaf);
      if (!paragraph) return;
      leaf = paragraph;
    }
    if (leaf.tagName === 'LI') {
      const list = leaf.parentElement;
      const index = list ? Array.from(list.children).indexOf(leaf) : -1;
      if (!list || index < 0) return;
      const paragraphs = unwrapList(list);
      leaf = paragraphs[index] ?? paragraphs[0];
    }
    const next = renameBlock(leaf, tag);
    placeCaret(next, 'end');
  }, []);

  const applyList = useCallback((kind: 'ul' | 'ol') => {
    const root = editorRef.current;
    if (!root) return;
    const leaf = currentBlock(root);
    const top = currentTopBlock(root);
    if (!leaf || !top) return;

    if (top.tagName === 'UL' || top.tagName === 'OL') {
      if (top.tagName.toLowerCase() === kind) {
        const index = Array.from(top.children).indexOf(leaf);
        const paragraphs = unwrapList(top);
        placeCaret(paragraphs[Math.max(0, index)] ?? paragraphs[0], 'end');
      } else {
        const renamed = renameList(top, kind);
        const item = renamed.children[Math.max(0, Array.from(top.children).indexOf(leaf))] as HTMLElement | undefined;
        placeCaret((item ?? renamed) as HTMLElement, 'end');
      }
      return;
    }

    const target = leaf.matches('p[data-note-type]') ? unwrapNoteRow(leaf) : leaf;
    if (!target) return;
    placeCaret(wrapBlockAsListItem(target, kind), 'end');
  }, []);

  const insertBlockNode = useCallback((node: HTMLElement) => {
    const root = editorRef.current;
    if (!root) return;
    insertBlock(root, node);
  }, []);

  const insertInlineNode = useCallback((node: Node) => {
    const root = editorRef.current;
    if (!root) return;
    insertInline(root, node);
  }, []);

  const makeApi = useCallback((): EditorApi | null => {
    const root = editorRef.current;
    if (!root) return null;
    return {
      root,
      insertBlock: insertBlockNode,
      insertInline: insertInlineNode,
      setBlockTag: applyBlockTag,
      toggleList: applyList,
      askFor: (label: string) => window.prompt(label),
    };
  }, [applyBlockTag, applyList, insertBlockNode, insertInlineNode]);

  // --- toolbar ---------------------------------------------------------------

  const runMark = useCallback((command: string) => {
    const root = editorRef.current;
    if (!root) return;
    restoreSelection(selectionRef.current);
    root.focus();
    exec(command);
    selectionRef.current = saveSelection();
    emitChange();
  }, [emitChange]);

  const runBlock = useCallback((action: () => void) => {
    const root = editorRef.current;
    if (!root) return;
    restoreSelection(selectionRef.current);
    root.focus();
    restoreSelection(selectionRef.current);
    action();
    selectionRef.current = saveSelection();
    emitChange();
  }, [emitChange]);

  const applyFontFamily = useCallback((family: FontFamily) => {
    setActiveFontFamily(family);
    runBlock(() => {
      const root = editorRef.current;
      if (root) styleSelection(root, 'fontFamily', FONT_FAMILIES[family]);
    });
  }, [runBlock]);

  const applyFontSize = useCallback((size: FontSize) => {
    setActiveFontSize(size);
    runBlock(() => {
      const root = editorRef.current;
      if (root) styleSelection(root, 'fontSize', FONT_SIZES[size]);
    });
  }, [runBlock]);

  const colorOptions = useMemo(
    () => [
      'var(--nebula-900)',
      'var(--nebula-800)',
      'var(--nebula-600)',
      'var(--nebula-500)',
      '#0f172a',
      '#475569',
      '#e2e8f0',
      '#ffffff',
    ],
    [],
  );

  const applyColor = useCallback((color: string) => {
    runBlock(() => {
      const root = editorRef.current;
      if (root) styleSelection(root, activeColorTarget === 'text' ? 'color' : 'backgroundColor', color);
    });
    setShowColorPicker(false);
  }, [activeColorTarget, runBlock]);

  // --- tables ---------------------------------------------------------------

  const focusSafeLocation = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const target = (root.querySelector(TOP_BLOCK_SELECTOR) as HTMLElement | null) ?? null;
    if (target) placeCaret(target, 'end');
    else {
      const paragraph = createBlock('p');
      root.appendChild(paragraph);
      placeCaret(paragraph, 'start');
    }
  }, []);

  const applyTableMutation = useCallback((mutate: (info: TableCellInfo) => boolean) => {
    const root = editorRef.current;
    if (!root || disabled) return;
    const info = getTableCellInfo(root);
    if (!info) {
      setShowTableToolbar(false);
      return;
    }
    const needsFallback = mutate(info);
    if (needsFallback) focusSafeLocation();
    else root.focus();
    selectionRef.current = saveSelection();
    emitChange();
  }, [disabled, emitChange, focusSafeLocation]);

  const updateTableToolbarPosition = useCallback(() => {
    const root = editorRef.current;
    if (!root || typeof window === 'undefined') {
      setShowTableToolbar(false);
      return;
    }
    const info = getTableCellInfo(root);
    if (!info) {
      setShowTableToolbar(false);
      return;
    }
    const rect = info.cell.getBoundingClientRect();
    const width = 330;
    let left = rect.left;
    let top = rect.top - 42;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (top < 12) top = rect.bottom + 8;
    setTableToolbarPosition({ top: Math.max(12, top), left: Math.max(12, left) });
    setShowTableToolbar(true);
  }, []);

  // --- slash menu -----------------------------------------------------------

  const updateMenuPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const rect = selection.getRangeAt(0).cloneRange().getBoundingClientRect();
    const width = 288;
    const height = 320;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
    setMenuPosition({ top: Math.max(12, top), left: Math.max(12, left) });
  }, []);

  const closeSlashMenu = useCallback(() => {
    triggerRef.current = null;
    slash.close();
  }, [slash]);

  /**
   * Open the menu when the caret sits after a "/". Unlike the old detection,
   * this reads the caret's offset inside its block rather than requiring
   * range.startContainer to be a text node -- which is why "/" at the start of
   * an empty block (a block holding only its <br> placeholder) never used to
   * open anything.
   */
  const inspectSlashTrigger = useCallback(() => {
    const root = editorRef.current;
    if (!root || typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || !selection.anchorNode) {
      closeSlashMenu();
      return;
    }
    if (!root.contains(selection.anchorNode)) {
      closeSlashMenu();
      return;
    }
    const block = currentBlock(root);
    if (!block) {
      closeSlashMenu();
      return;
    }
    const host = (block.querySelector('[data-note-content]') as HTMLElement | null) ?? block;
    const offset = getOffsetWithin(host, selection);
    const before = textBeforeCaret(host);
    if (before === null) {
      closeSlashMenu();
      return;
    }
    const match = before.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!match || match.index === undefined) {
      closeSlashMenu();
      return;
    }
    // `before` counts a <br> as a newline; `offset` and rangeForOffsets count
    // text nodes only. The "/query" run itself never contains a break, so
    // measuring the start backwards from the caret keeps the two in step.
    const slashIndex = match.index + match[0].indexOf('/');
    triggerRef.current = { host, start: offset - (before.length - slashIndex), end: offset };
    const query = match[1] ?? '';
    if (slash.open) slash.setQuery(query);
    else slash.openAt(query);
    updateMenuPosition();
  }, [closeSlashMenu, slash, updateMenuPosition]);

  /** Remove the typed "/query" before a command writes anything. */
  const consumeTrigger = useCallback(() => {
    const trigger = triggerRef.current;
    triggerRef.current = null;
    const root = editorRef.current;
    if (!trigger || !root) return;
    const range = rangeForOffsets(trigger.host, trigger.start, trigger.end);
    if (!range) return;
    range.deleteContents();
    // Deleting the query can leave the host holding nothing but an empty text
    // node, which renders at zero height; the placeholder keeps it typeable.
    ensurePlaceholder(trigger.host);
    const selection = window.getSelection();
    if (!selection) return;
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const activateSlashRow = useCallback((row: MenuRow) => {
    const root = editorRef.current;
    const api = makeApi();
    if (!root || !api) return;
    root.focus();
    slash.activate(row, api, consumeTrigger);
    if (row.node.kind === 'action') {
      selectionRef.current = saveSelection();
      emitChange();
    }
  }, [consumeTrigger, emitChange, makeApi, slash]);

  const activateSlashGrid = useCallback((rows: number, columns: number) => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    consumeTrigger();
    insertBlock(root, createTable(rows, columns));
    slash.close();
    selectionRef.current = saveSelection();
    emitChange();
  }, [consumeTrigger, emitChange, slash]);

  const goBackOneLevel = useCallback(() => {
    editorRef.current?.focus();
    slash.back();
  }, [slash]);

  // The trigger range only means anything while the menu is open.
  useEffect(() => {
    if (!slash.open) triggerRef.current = null;
  }, [slash.open]);

  // --- input handling -------------------------------------------------------

  /**
   * Select-all + Delete empties the root outright, and typing into a root with
   * no block child leaves a bare text node -- at which point every block
   * operation has nothing to act on. Cheap to check (a no-op while the caret is
   * in a block, which is the normal case) and it keeps the invariant true
   * without normalizing on every keystroke.
   */
  const ensureBlockInvariant = useCallback(() => {
    const root = editorRef.current;
    if (!root || currentBlock(root)) return;
    const caret = getCaretOffset(root);
    normalizeBlocks(root);
    if (caret !== null) setCaretOffset(root, caret);
  }, []);

  const onInput = useCallback(() => {
    if (isComposingRef.current) return;
    ensureBlockInvariant();
    selectionRef.current = saveSelection();
    emitChange();
    inspectSlashTrigger();
  }, [emitChange, ensureBlockInvariant, inspectSlashTrigger]);

  const insertPastedNodes = useCallback((nodes: Node[]) => {
    const root = editorRef.current;
    if (!root || !nodes.length) return;
    const leaf = currentBlock(root);
    const top = currentTopBlock(root);
    if (!top) {
      nodes.forEach((node) => root.appendChild(node));
      normalizeBlocks(root);
      return;
    }
    const splitHere = !!leaf && leaf === top && !isEmptyBlock(leaf);
    const tail = splitHere ? splitBlock(top, 'p') : null;
    const anchor = tail ?? top.nextSibling;
    const parent = top.parentNode;
    if (!parent) return;
    const inserted: HTMLElement[] = [];
    for (const node of nodes) {
      parent.insertBefore(node, anchor);
      if (node.nodeType === Node.ELEMENT_NODE) inserted.push(node as HTMLElement);
    }
    if (leaf && leaf === top && isEmptyBlock(top)) top.remove();
    if (tail && isEmptyBlock(tail)) tail.remove();
    normalizeBlocks(root);
    const last = inserted[inserted.length - 1];
    if (last?.isConnected) placeCaret(last, 'end');
  }, []);

  const onPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Without this the browser inserts the source's markup verbatim, styles and
    // wrapper spans included. Shift+paste forces plain text.
    event.preventDefault();
    const clipboard = event.clipboardData;
    const root = editorRef.current;
    if (!clipboard || !root) return;
    const asHtml = clipboard.getData('text/html');
    const asText = clipboard.getData('text/plain');
    const payload =
      asHtml && !plainPasteRef.current
        ? sanitizePastedHtml(asHtml)
        : escapeHtml(asText).replace(/\r?\n/g, '<br />');
    const template = document.createElement('template');
    template.innerHTML = payload;
    const nodes = Array.from(template.content.childNodes);
    const hasBlocks = nodes.some(
      (node) => node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(TOP_BLOCK_SELECTOR),
    );
    if (hasBlocks) insertPastedNodes(nodes);
    else insertInline(root, template.content);
    selectionRef.current = saveSelection();
    emitChange();
  }, [disabled, emitChange, insertPastedNodes]);

  const onEnter = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const root = editorRef.current;
    if (!root) return;

    if (event.shiftKey) {
      event.preventDefault();
      insertLineBreak(root);
      emitChange();
      return;
    }

    const noteContext = getNoteRowContext(root);
    if (noteContext) {
      event.preventDefault();
      if (isNoteContentEmpty(noteContext.content)) {
        const paragraph = unwrapNoteRow(noteContext.row);
        if (paragraph) placeCaret(paragraph, 'start');
      } else {
        continueNoteRow(noteContext.row, noteContext.type);
      }
      emitChange();
      return;
    }

    const leaf = currentBlock(root);
    if (!leaf) return;
    event.preventDefault();

    if (leaf.tagName === 'TD' || leaf.tagName === 'TH') {
      insertLineBreak(root);
      emitChange();
      return;
    }
    if (leaf.tagName === 'LI') {
      if (isEmptyBlock(leaf)) exitList(leaf);
      else splitBlock(leaf);
      emitChange();
      return;
    }
    // Code blocks, quotes and callouts hold several lines, so Enter adds a line
    // inside them -- but Enter on an empty last line has to leave, or there is
    // no way out at all and every command typed afterwards lands in the block
    // as plain text.
    const holdsManyLines = leaf.tagName === 'PRE' || leaf.tagName === 'BLOCKQUOTE' || leaf.matches('div[data-callout]');
    if (holdsManyLines) {
      const usesTextNewlines = leaf.tagName === 'PRE';
      const before = textBeforeCaret(leaf) ?? '';
      const after = textAfterCaret(leaf) ?? '';
      const onEmptyLine = before === '' || before.endsWith('\n');
      const nothingAfter = after.replace(/\s/g, '') === '';
      if (onEmptyLine && nothingAfter) {
        if (usesTextNewlines) trimTrailingNewlines(leaf);
        else trimTrailingBreaks(leaf);
        const paragraph = createBlock('p');
        if (isEmptyBlock(leaf)) {
          leaf.replaceWith(paragraph);
        } else {
          ensurePlaceholder(leaf);
          leaf.after(paragraph);
        }
        placeCaret(paragraph, 'start');
      } else if (usesTextNewlines) {
        insertNewlineInPre(root);
      } else {
        insertLineBreak(root);
      }
      emitChange();
      return;
    }
    // A heading does not continue into another heading.
    const continuesAs: BlockTag = /^H[123]$/.test(leaf.tagName) ? 'p' : (leaf.tagName.toLowerCase() as BlockTag);
    splitBlock(leaf, continuesAs);
    emitChange();
  }, [emitChange]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const root = editorRef.current;
    if (!root || disabled) return;
    ensureBlockInvariant();

    if (slash.open) {
      const api = makeApi();
      // Emit unconditionally: `slash.open` is still true in this closure even
      // when the key just ran a command and closed the menu, so testing it here
      // would swallow the change the command made.
      if (api && slash.handleKeyDown(event, api, consumeTrigger)) {
        selectionRef.current = saveSelection();
        emitChange();
        return;
      }
    }

    const noteContext = getNoteRowContext(root);

    // The leading affordance and the trailing meta are contenteditable="false",
    // so the caret should never be in them; this stays as a belt.
    if (
      noteContext &&
      (noteContext.withinLeading || noteContext.withinTrailing) &&
      !event.ctrlKey && !event.metaKey && !event.altKey &&
      (event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete' || event.key.length === 1)
    ) {
      event.preventDefault();
      placeCaret(noteContext.row, event.key === 'Backspace' ? 'end' : 'start');
      selectionRef.current = saveSelection();
      return;
    }

    if (noteContext && (event.key === 'Backspace' || event.key === 'Delete')) {
      const offset = getOffsetWithin(noteContext.content, noteContext.selection);
      const length = (noteContext.content.textContent ?? '').replace(/\u00a0/g, ' ').length;
      if (event.key === 'Backspace' && offset === 0) {
        // Leave the row rather than let Backspace chew through its structure --
        // and keep whatever the user had typed in it.
        event.preventDefault();
        const paragraph = unwrapNoteRow(noteContext.row);
        if (paragraph) placeCaret(paragraph, 'start');
        selectionRef.current = saveSelection();
        emitChange();
        return;
      }
      if (event.key === 'Delete' && offset >= length) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Enter') {
      onEnter(event);
    }
  }, [consumeTrigger, disabled, emitChange, ensureBlockInvariant, makeApi, onEnter, slash]);

  // --- ambient listeners ----------------------------------------------------

  useEffect(() => {
    if (!slash.open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (slashMenuRef.current?.contains(target)) return;
      if (editorRef.current?.contains(target)) return;
      closeSlashMenu();
    };
    const handleSelectionChange = () => {
      const root = editorRef.current;
      const anchor = window.getSelection()?.anchorNode;
      if (!root || !anchor || !root.contains(anchor)) closeSlashMenu();
      else updateMenuPosition();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('resize', updateMenuPosition);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [closeSlashMenu, slash.open, updateMenuPosition]);

  useEffect(() => {
    updateTableToolbarPosition();
    const handle = () => updateTableToolbarPosition();
    document.addEventListener('selectionchange', handle);
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      document.removeEventListener('selectionchange', handle);
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
  }, [updateTableToolbarPosition]);

  useEffect(() => {
    if (!showColorPicker) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (colorPickerRef.current && target && !colorPickerRef.current.contains(target)) setShowColorPicker(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowColorPicker(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showColorPicker]);

  // --- render ---------------------------------------------------------------

  const markButton = (label: string, command: 'bold' | 'italic' | 'underline', glyph: React.ReactNode) => (
    <button
      type="button"
      className={`${ICON_BUTTON_CLASS} ${activeMarks[command] ? ACTIVE_BUTTON_CLASS : ''}`}
      aria-pressed={activeMarks[command]}
      disabled={disabled}
      onClick={() => runMark(command)}
      aria-label={label}
      title={label}
    >
      {glyph}
    </button>
  );

  const blockButton = (label: string, tag: BlockTag, glyph: React.ReactNode) => (
    <button
      type="button"
      className={`${BUTTON_CLASS} ${activeBlock === tag ? ACTIVE_BUTTON_CLASS : ''}`}
      aria-pressed={activeBlock === tag}
      disabled={disabled}
      onClick={() => runBlock(() => applyBlockTag(tag))}
      aria-label={label}
      title={label}
    >
      {glyph}
    </button>
  );

  return (
    <div
      className={`flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-white dark:bg-[#1e1e1e] ${className}`.trim()}
    >
      <div
        className={`shrink-0 flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-100 px-3 py-1.5 dark:border-[#3e3e3e] dark:bg-[#252526] ${toolbarClassName}`.trim()}
        onMouseDown={(event) => event.preventDefault()}
      >
        <div className={GROUP_CLASS}>
          {markButton('Bold', 'bold', <span className="font-bold">B</span>)}
          {markButton('Italic', 'italic', <span className="italic">I</span>)}
          {markButton('Underline', 'underline', <span className="underline">U</span>)}
        </div>
        <div className={DIVIDER_CLASS} aria-hidden="true" />
        <div className={GROUP_CLASS}>
          {blockButton('Normal text', 'p', <>Aa</>)}
          {blockButton('Heading 1', 'h1', <>H1</>)}
          {blockButton('Heading 2', 'h2', <>H2</>)}
          {blockButton('Heading 3', 'h3', <>H3</>)}
          {blockButton('Quote', 'blockquote', <>&ldquo;</>)}
          {blockButton('Code block', 'pre', <>{'</>'}</>)}
        </div>
        <div className={DIVIDER_CLASS} aria-hidden="true" />
        <div className={GROUP_CLASS}>
          <button
            type="button"
            className={`${ICON_BUTTON_CLASS} ${activeBlock === 'ul' ? ACTIVE_BUTTON_CLASS : ''}`}
            aria-pressed={activeBlock === 'ul'}
            disabled={disabled}
            onClick={() => runBlock(() => applyList('ul'))}
            aria-label="Bullet list"
            title="Bullet list"
          >
            <span aria-hidden="true">&bull;</span>
          </button>
          <button
            type="button"
            className={`${ICON_BUTTON_CLASS} ${activeBlock === 'ol' ? ACTIVE_BUTTON_CLASS : ''}`}
            aria-pressed={activeBlock === 'ol'}
            disabled={disabled}
            onClick={() => runBlock(() => applyList('ol'))}
            aria-label="Numbered list"
            title="Numbered list"
          >
            <span aria-hidden="true">1.</span>
          </button>
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            disabled={disabled}
            onClick={() => runBlock(() => insertBlockNode(createTable(3, 3)))}
            aria-label="Insert table"
            title="Insert table"
          >
            <span aria-hidden="true">&#9638;</span>
          </button>
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            disabled={disabled}
            onClick={() =>
              runBlock(() => {
                const url = window.prompt('Image URL');
                if (!url) return;
                const wrapper = document.createElement('p');
                const image = document.createElement('img');
                image.src = url;
                image.alt = '';
                wrapper.appendChild(image);
                insertBlockNode(wrapper);
              })
            }
            aria-label="Insert image"
            title="Insert image"
          >
            <span aria-hidden="true">&#9634;</span>
          </button>
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            disabled={disabled}
            onClick={() => runBlock(() => insertBlockNode(document.createElement('hr')))}
            aria-label="Insert divider"
            title="Insert divider"
          >
            <span aria-hidden="true">&mdash;</span>
          </button>
        </div>
        <div className={DIVIDER_CLASS} aria-hidden="true" />
        <div className={GROUP_CLASS}>
          <label className="sr-only" htmlFor="rich-notes-font-family">Font family</label>
          <select
            id="rich-notes-font-family"
            className={SELECT_CLASS}
            value={activeFontFamily}
            disabled={disabled}
            onMouseDown={(event) => event.nativeEvent.stopImmediatePropagation()}
            onPointerDown={(event) => event.nativeEvent.stopImmediatePropagation()}
            onChange={(event) => applyFontFamily(event.target.value as FontFamily)}
            aria-label="Font family"
          >
            <option value="sans">Sans</option>
            <option value="serif">Serif</option>
            <option value="mono">Mono</option>
          </select>
          <label className="sr-only" htmlFor="rich-notes-font-size">Font size</label>
          <select
            id="rich-notes-font-size"
            className={SELECT_CLASS}
            value={activeFontSize}
            disabled={disabled}
            onMouseDown={(event) => event.nativeEvent.stopImmediatePropagation()}
            onPointerDown={(event) => event.nativeEvent.stopImmediatePropagation()}
            onChange={(event) => applyFontSize(event.target.value as FontSize)}
            aria-label="Font size"
          >
            <option value="sm">Small</option>
            <option value="base">Base</option>
            <option value="lg">Large</option>
          </select>
        </div>
        <div className="relative ml-auto" ref={colorPickerRef}>
          <button
            type="button"
            className={`${ICON_BUTTON_CLASS} ${showColorPicker ? ACTIVE_BUTTON_CLASS : ''}`}
            disabled={disabled}
            onClick={() => setShowColorPicker((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={showColorPicker}
            aria-label="Text color"
            title="Text color"
          >
            <span aria-hidden="true">A</span>
          </button>
          {showColorPicker && (
            <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-[#3e3e3e] dark:bg-[#252526]">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-500">
                Text &amp; highlight
              </div>
              <div className="grid grid-cols-4 gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="h-7 w-7 rounded-md border border-slate-200 transition hover:scale-105 dark:border-[#3e3e3e]"
                    style={{ backgroundColor: color }}
                    disabled={disabled}
                    aria-label={`Apply color ${color}`}
                    onClick={() => applyColor(color)}
                  />
                ))}
              </div>
              <div className="mt-3 flex gap-1.5">
                <button
                  type="button"
                  className={`${BUTTON_CLASS} ${activeColorTarget === 'text' ? ACTIVE_BUTTON_CLASS : ''}`}
                  disabled={disabled}
                  onClick={() => setActiveColorTarget('text')}
                >
                  Text
                </button>
                <button
                  type="button"
                  className={`${BUTTON_CLASS} ${activeColorTarget === 'highlight' ? ACTIVE_BUTTON_CLASS : ''}`}
                  disabled={disabled}
                  onClick={() => setActiveColorTarget('highlight')}
                >
                  Highlight
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden bg-white dark:bg-[#1e1e1e]">
        <div
          ref={editorRef}
          contentEditable={!disabled}
          dir="ltr"
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={placeholder}
          data-blank="true"
          onInput={onInput}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onClick={(event) => {
            const toggle = (event.target as HTMLElement | null)?.closest('[data-note-task-toggle="true"]');
            if (!toggle || disabled) return;
            const row = toggle.closest('p[data-note-type="task"]') as HTMLElement | null;
            if (!row) return;
            event.preventDefault();
            event.stopPropagation();
            updateTaskRowCompletion(row, row.getAttribute('data-task-completed') !== 'true');
            selectionRef.current = saveSelection();
            emitChange();
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            onInput();
          }}
          onBlur={() => {
            selectionRef.current = saveSelection();
            emitChange();
            window.setTimeout(() => closeSlashMenu(), 120);
          }}
          className={`zero-note flex-1 min-h-0 w-full min-w-0 overflow-y-auto px-6 py-5 outline-none ${editorClassName}`.trim()}
        />
      </div>

      {showTableToolbar && !disabled && (
        <div
          className="fixed z-[60] flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-2xl dark:border-[#3e3e3e] dark:bg-[#252526]"
          style={{ top: tableToolbarPosition.top, left: tableToolbarPosition.left }}
        >
          <button type="button" className={BUTTON_CLASS} onMouseDown={(e) => e.preventDefault()} onClick={() => applyTableMutation((info) => addTableRow(info, 'before'))} aria-label="Add row above" title="Add row above">Row&nbsp;<span className="text-nebula-600 dark:text-nebula-500">&#43;&#8593;</span></button>
          <button type="button" className={BUTTON_CLASS} onMouseDown={(e) => e.preventDefault()} onClick={() => applyTableMutation((info) => addTableRow(info, 'after'))} aria-label="Add row below" title="Add row below">Row&nbsp;<span className="text-nebula-600 dark:text-nebula-500">&#43;&#8595;</span></button>
          <button type="button" className={BUTTON_CLASS} onMouseDown={(e) => e.preventDefault()} onClick={() => applyTableMutation(removeTableRow)} aria-label="Remove row" title="Remove row">Row&nbsp;<span className="text-rose-600 dark:text-rose-400">&minus;</span></button>
          <button type="button" className={BUTTON_CLASS} onMouseDown={(e) => e.preventDefault()} onClick={() => applyTableMutation((info) => addTableColumn(info, 'before'))} aria-label="Add column before" title="Add column before">Col&nbsp;<span className="text-nebula-600 dark:text-nebula-500">&#43;&#8592;</span></button>
          <button type="button" className={BUTTON_CLASS} onMouseDown={(e) => e.preventDefault()} onClick={() => applyTableMutation((info) => addTableColumn(info, 'after'))} aria-label="Add column after" title="Add column after">Col&nbsp;<span className="text-nebula-600 dark:text-nebula-500">&#43;&#8594;</span></button>
          <button type="button" className={BUTTON_CLASS} onMouseDown={(e) => e.preventDefault()} onClick={() => applyTableMutation(removeTableColumn)} aria-label="Remove column" title="Remove column">Col&nbsp;<span className="text-rose-600 dark:text-rose-400">&minus;</span></button>
          <button type="button" className={BUTTON_CLASS} onMouseDown={(e) => e.preventDefault()} onClick={() => applyTableMutation(removeTable)} aria-label="Remove table" title="Remove table"><span className="text-rose-600 dark:text-rose-400">Del table</span></button>
        </div>
      )}

      {slash.open && !disabled && (
        <SlashMenu
          controller={slash}
          position={menuPosition}
          menuRef={slashMenuRef}
          onActivate={activateSlashRow}
          onActivateGrid={activateSlashGrid}
          onBack={goBackOneLevel}
        />
      )}
    </div>
  );
}

export default RichNotesEditor;
