import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DecisionIcon = ({ className = '', size = 16 }: { className?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 22V13" />
    <path d="M12 13c0-3 2-4 4-6l3-3" />
    <path d="M12 13c0-3-2-4-4-6l-3-3" strokeDasharray="3 3" opacity="0.4" />
    <path d="M16 4h4v4" />
  </svg>
);

const LogIcon = ({ className = '', size = 16 }: { className?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M7 4h7l3 3v13H7z" />
    <path d="M14 4v3h3" />
    <path d="M9 11h6" />
    <path d="M9 15h6" />
  </svg>
);

const SLASH_ITEMS = [
  { id: 'task', label: 'Task', hint: 'Insert task starter' },
  { id: 'decision', label: 'Decision', hint: 'Insert decision marker' },
  { id: 'log', label: 'Log', hint: 'Insert dated log entry' },
  { id: 'date', label: 'Date', hint: 'Insert today' },
] as const;

type SlashItemId = (typeof SLASH_ITEMS)[number]['id'];

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
type FontFamily = 'inter' | 'serif' | 'mono';
type FontSize = 'sm' | 'base' | 'lg';

type TableCellInfo = {
  table: HTMLTableElement;
  tbody: HTMLTableSectionElement;
  row: HTMLTableRowElement;
  cell: HTMLTableCellElement;
  rowIndex: number;
  cellIndex: number;
};

function isSupportedTable(table: HTMLTableElement | null | undefined): table is HTMLTableElement {
  if (!table) return false;
  if (table.querySelector('thead, tfoot, colgroup, caption, table')) return false;
  const tbodyChildren = Array.from(table.children);
  if (tbodyChildren.length !== 1 || tbodyChildren[0].tagName !== 'TBODY') return false;
  const tbody = tbodyChildren[0] as HTMLTableSectionElement;
  const rows = Array.from(tbody.rows);
  if (rows.length === 0) return false;
  const width = rows[0].cells.length;
  if (width === 0) return false;
  return rows.every((row) => row.tagName === 'TR' && row.cells.length === width && Array.from(row.cells as HTMLCollectionOf<HTMLTableCellElement>).every((cell) => {
    return (cell.tagName === 'TD' || cell.tagName === 'TH') && cell.rowSpan === 1 && cell.colSpan === 1 && !cell.querySelector('table');
  }));
}

const SELECT_CLASS = 'h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-medium tracking-[0.04em] text-slate-500 shadow-sm transition duration-150 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-nebula-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus:ring-nebula-400/20 appearance-auto';

const BUTTON_CLASS = 'inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium tracking-[0.04em] text-slate-500 shadow-sm transition duration-150 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:active:bg-slate-700';
const ICON_BUTTON_CLASS = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition duration-150 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:active:bg-slate-700';
const ACTIVE_BUTTON_CLASS = 'border-nebula-500/45 bg-nebula-50 text-nebula-800 dark:border-nebula-400/40 dark:bg-nebula-500/15 dark:text-nebula-100 dark:hover:bg-nebula-500/20 dark:active:bg-nebula-500/25';

function exec(cmd: string, value?: string) {
  if (typeof document === 'undefined') return false;
  try {
    return document.execCommand(cmd, false, value);
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

function isCommandActive(command: string) {
  if (typeof document === 'undefined') return false;
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}


function getClosestBlockTag(): 'p' | 'h1' | 'h2' | 'ul' | 'ol' | '' {
  if (typeof window === 'undefined') return '';
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!node) return '';
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const block = element?.closest('p, h1, h2, ul, ol');
  return (block?.tagName.toLowerCase() as 'p' | 'h1' | 'h2' | 'ul' | 'ol' | undefined) ?? '';
}

// The stored value must be exactly what the browser produced. This used to
// rewrite <div><br></div> into <br />, which meant every line break made the
// state disagree with the DOM, forcing the controlled-value effect to rebuild
// the editor and lose the caret. It also changed the rendering: <div><br></div>
// is a block, <br /> is an inline break.
function sanitizeHtml(html: string) {
  return html;
}

// Offsets survive an innerHTML rebuild; a Range does not, because every node it
// points at is destroyed. Only syncEditorContent needs this -- the toolbar's
// saveSelection/restoreSelection pair works on a live DOM and stays as it is.
function getCaretOffset(root: HTMLElement): number | null {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const probe = range.cloneRange();
  probe.selectNodeContents(root);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length;
}

function setCaretOffset(root: HTMLElement, offset: number) {
  if (typeof window === 'undefined') return;
  const selection = window.getSelection();
  if (!selection) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }
  // Offset past the end (content shrank): land at the very end.
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Structural tags worth keeping on paste. Everything else is unwrapped rather
// than dropped, so the text survives even when the source markup does not.
const PASTE_ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI',
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'PRE', 'BLOCKQUOTE', 'A',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
]);

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
          child.tagName === 'A' &&
          attr.name === 'href' &&
          /^(https?:|mailto:|#|\/)/i.test(attr.value.trim());
        if (!isSafeHref) child.removeAttribute(attr.name);
      }
    }
  };

  strip(template.content);
  return template.innerHTML;
}

function getTableCellInfo(): TableCellInfo | null {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const anchorNode = selection.anchorNode;
  if (!anchorNode) return null;
  const element = anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : anchorNode.parentElement;
  const cell = element?.closest('td, th') as HTMLTableCellElement | null;
  if (!cell) return null;
  const row = cell.parentElement as HTMLTableRowElement | null;
  const tbody = row?.parentElement as HTMLTableSectionElement | null;
  const table = tbody?.closest('table') as HTMLTableElement | null;
  if (!row || !tbody || !table || tbody.tagName !== 'TBODY' || row.tagName !== 'TR') return null;
  if (!isSupportedTable(table)) return null;
  const rows = Array.from(tbody.rows);
  const rowIndex = rows.indexOf(row);
  const cellIndex = Array.from(row.cells).indexOf(cell);
  if (rowIndex < 0 || cellIndex < 0) return null;
  return { table, tbody, row, cell, rowIndex, cellIndex };
}

function setSelectionInsideCell(cell: HTMLTableCellElement) {
  if (typeof window === 'undefined') return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function createEmptyTableCell(tagName: 'TD' | 'TH' = 'TD') {
  const cell = document.createElement(tagName.toLowerCase()) as HTMLTableCellElement;
  cell.innerHTML = '&nbsp;';
  cell.rowSpan = 1;
  cell.colSpan = 1;
  return cell;
}

function createNoteRowHtml(noteType: 'task' | 'decision' | 'log', id: string, metaHtml = '', completed = false) {
  const leadingHtml = noteType === 'task'
    ? `<button type="button" contenteditable="false" data-note-task-toggle="true" aria-pressed="${completed}" aria-label="Mark task as ${completed ? 'incomplete' : 'completed'}" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border border-slate-400 bg-white text-[11px] leading-none text-slate-500 transition hover:border-slate-500 hover:text-slate-700 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-300 dark:hover:text-slate-100">${completed ? '✓' : ''}</button>`
    : noteType === 'decision'
      ? '<span aria-hidden="true" class="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center text-nebula-700 dark:text-nebula-300"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V13" /><path d="M12 13c0-3 2-4 4-6l3-3" /><path d="M12 13c0-3-2-4-4-6l-3-3" stroke-dasharray="3 3" opacity="0.4" /><path d="M16 4h4v4" /></svg></span>'
      : '<span aria-hidden="true" class="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center text-slate-400 dark:text-slate-500"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h7l3 3v13H7z" /><path d="M14 4v3h3" /><path d="M9 11h6" /><path d="M9 15h6" /></svg></span>';
  const taskStateAttrs = noteType === 'task' ? ` data-task-completed="${completed}"` : '';
  const noteMetaHtml = metaHtml ? `<span data-note-meta="true" class="inline-flex items-center justify-end self-center gap-1 whitespace-nowrap text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">${metaHtml}</span>` : '';
  const noteClassName = noteType === 'task'
    ? 'group relative flex w-full items-center gap-2 rounded-lg px-2 py-1'
    : noteType === 'decision'
      ? 'group relative flex w-full items-center gap-2 rounded-lg border-l-2 border-nebula-200 px-2 py-1 italic text-slate-700 dark:border-nebula-500/40 dark:text-slate-100'
      : 'group relative flex w-full items-center gap-2 rounded-lg border-l border-slate-200 px-2 py-1 text-slate-700 dark:border-slate-700 dark:text-slate-200';
  const contentClassName = noteType === 'task' && completed ? 'min-w-0 flex-1 italic' : 'min-w-0 flex-1';
  return `<p data-note-type="${noteType}" data-note-id="${id}"${taskStateAttrs} class="${noteClassName}"><span data-note-leading="true" class="shrink-0">${leadingHtml}</span><span data-note-content="true" class="${contentClassName}">&nbsp;</span><span data-note-trailing-meta="true" class="ml-auto shrink-0 text-right">${noteMetaHtml}</span></p>`;
}

function updateTaskRowCompletion(noteRow: HTMLElement, completed: boolean) {
  noteRow.setAttribute('data-task-completed', String(completed));
  const toggle = noteRow.querySelector('[data-note-task-toggle="true"]') as HTMLButtonElement | null;
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(completed));
    toggle.setAttribute('aria-label', `Mark task as ${completed ? 'incomplete' : 'completed'}`);
    toggle.textContent = completed ? '✓' : '';
  }
  const text = noteRow.querySelector('[data-note-content]');
  text?.classList.toggle('italic', completed);
}

function getNoteRowContext() {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  if (!selection || !anchorNode || !selection.isCollapsed) return null;
  const anchorElement = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : (anchorNode as Element | null);
  const noteBlock = anchorElement?.closest('p[data-note-type]') as HTMLElement | null;
  const noteType = noteBlock?.getAttribute('data-note-type') as 'task' | 'decision' | 'log' | null;
  const content = noteBlock?.querySelector('[data-note-content]') as HTMLElement | null;
  const leading = noteBlock?.querySelector('[data-note-leading]') as HTMLElement | null;
  const trailing = noteBlock?.querySelector('[data-note-trailing-meta]') as HTMLElement | null;
  if (!noteBlock || !noteType || !content) return null;
  const withinContent = content.contains(anchorNode) || content === anchorElement || content.contains(anchorElement ?? null);
  const withinLeading = !!leading && (leading.contains(anchorNode) || leading === anchorElement || leading.contains(anchorElement ?? null));
  const withinTrailing = !!trailing && (trailing.contains(anchorNode) || trailing === anchorElement || trailing.contains(anchorElement ?? null));
  return { noteBlock, noteType, content, leading, trailing, withinContent, withinLeading, withinTrailing, selection };
}

function placeCaretAtStart(node: HTMLElement) {
  if (typeof window === 'undefined') return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtEnd(node: HTMLElement) {
  if (typeof window === 'undefined') return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertNoteRowAfter(currentRow: HTMLElement, html: string) {
  currentRow.insertAdjacentHTML('afterend', html);
  return currentRow.nextElementSibling as HTMLElement | null;
}

function ensureCaretInsideNoteContent(noteContent: HTMLElement, position: 'start' | 'end' = 'start') {
  const textContent = noteContent.textContent ?? '';
  if (!textContent.replace(/ /g, '').trim()) {
    noteContent.innerHTML = '&nbsp;';
  }
  if (position === 'end') {
    placeCaretAtEnd(noteContent);
    return;
  }
  placeCaretAtStart(noteContent);
}

function isNoteContentVisuallyEmpty(noteContent: HTMLElement) {
  const textContent = noteContent.textContent ?? '';
  return !textContent.replace(/ /g, '').trim();
}

function getCaretOffsetWithin(container: HTMLElement, selection: Selection) {
  if (!selection.rangeCount) return 0;
  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().replace(/ /g, '').length;
}

function convertTaskRowToParagraph(noteRow: HTMLElement) {
  const content = noteRow.querySelector('[data-note-content]') as HTMLElement | null;
  if (!content) return null;
  const paragraph = document.createElement('p');
  paragraph.innerHTML = content.innerHTML.trim() || '&nbsp;';
  noteRow.replaceWith(paragraph);
  return paragraph;
}

function unwrapNoteRowToParagraph(noteRow: HTMLElement) {
  const content = noteRow.querySelector('[data-note-content]') as HTMLElement | null;
  if (!content) return null;
  const paragraph = document.createElement('p');
  paragraph.innerHTML = content.innerHTML.trim() || '&nbsp;';
  noteRow.replaceWith(paragraph);
  return paragraph;
}

function normalizeNoteContentPlaceholder(noteRow: HTMLElement) {
  const content = noteRow.querySelector('[data-note-content]') as HTMLElement | null;
  if (!content) return;
  if (isNoteContentVisuallyEmpty(content)) {
    content.innerHTML = '&nbsp;';
  }
}

function focusSafeEditorLocation(editor: HTMLDivElement | null) {
  if (!editor || typeof document === 'undefined') return;
  let target = Array.from(editor.querySelectorAll('p, li, h1, h2'))
    .find((el) => (el as HTMLElement).isContentEditable) as HTMLElement | undefined;
  if (!target) {
    target = document.createElement('p');
    target.innerHTML = '&nbsp;';
    editor.appendChild(target);
  }
  const range = document.createRange();
  const selection = window.getSelection();
  if (!selection) return;
  target.focus?.();
  range.selectNodeContents(target);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
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
  const [activeColorTarget, setActiveColorTarget] = useState<ColorControl | null>(null);
  const [activeFontFamily, setActiveFontFamily] = useState<FontFamily>('inter');
  const [activeFontSize, setActiveFontSize] = useState<FontSize>('base');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeMarks, setActiveMarks] = useState({ bold: false, italic: false, underline: false });
  const [activeBlock, setActiveBlock] = useState<'p' | 'h1' | 'h2' | 'ul' | 'ol' | ''>('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashPosition, setSlashPosition] = useState({ top: 0, left: 0 });
  const selectionRef = useRef<Range | null>(null);
  // Held while Shift is down, so Shift+V pastes unformatted text.
  const plainPasteRef = useRef(false);
  const slashCommandRangeRef = useRef<Range | null>(null);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedValueRef = useRef<string>('');
  const isComposingRef = useRef(false);

  const htmlValue = value ?? internalValue;
  const isControlled = value !== undefined;

  const syncActiveState = useCallback(() => {
    const block = getClosestBlockTag();
    setActiveBlock(block);
    setActiveMarks({
      bold: isCommandActive('bold'),
      italic: isCommandActive('italic'),
      underline: isCommandActive('underline'),
    });
  }, []);

  const syncEditorContent = useCallback((nextHtml: string) => {
    const el = editorRef.current;
    if (!el || el.innerHTML === nextHtml) return;
    const hadFocus = el === document.activeElement || el.contains(document.activeElement);
    const caret = hadFocus ? getCaretOffset(el) : null;
    el.innerHTML = nextHtml;
    if (caret !== null) setCaretOffset(el, caret);
  }, []);

  useEffect(() => {
    if (lastSyncedValueRef.current === htmlValue) return;
    lastSyncedValueRef.current = htmlValue;
    syncEditorContent(htmlValue);
  }, [htmlValue, syncEditorContent]);

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus();
    syncActiveState();
  }, [autoFocus, syncActiveState]);

  // A ClipboardEvent carries no modifier state, so Shift is tracked separately
  // to let Shift+V paste as unformatted text.
  useEffect(() => {
    const track = (event: KeyboardEvent) => { plainPasteRef.current = event.shiftKey; };
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
    };
  }, []);

  const emitChange = useCallback(() => {
    const html = sanitizeHtml(editorRef.current?.innerHTML ?? '');
    // Claim it as already synced. The DOM is this value's source, so the
    // controlled-value effect must not push it back and rebuild the editor --
    // that rebuild is what dropped line breaks, list structure and the caret.
    lastSyncedValueRef.current = html;
    if (!isControlled) setInternalValue(html);
    onChange?.(html);
    syncActiveState();
  }, [isControlled, onChange, syncActiveState]);

  const closeSlashMenu = useCallback(() => {
    setShowSlashMenu(false);
    setSlashQuery('');
    setSlashIndex(0);
    slashCommandRangeRef.current = null;
  }, []);

  const updateSlashMenuPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    const width = 260;
    const approxHeight = 220;
    let left = rect.left;
    let top = rect.bottom + 10;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (top + approxHeight > window.innerHeight - 12) top = rect.top - approxHeight - 10;
    setSlashPosition({ top: Math.max(12, top), left: Math.max(12, left) });
  }, []);

  const filteredSlashItems = useMemo(() => {
    const query = slashQuery.trim().toLowerCase();
    if (!query) return SLASH_ITEMS;
    return SLASH_ITEMS.filter((item) => item.label.toLowerCase().includes(query));
  }, [slashQuery]);

  const run = useCallback((command: string, valueArg?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection(selectionRef.current);
    editor.focus();
    exec(command, valueArg);
    selectionRef.current = saveSelection();
    emitChange();
  }, [emitChange]);

  const insertTable = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const liveSelection = saveSelection();
    const selectionToRestore = liveSelection ?? selectionRef.current;
    if (liveSelection) selectionRef.current = liveSelection;
    restoreSelection(selectionToRestore);
    editor.focus();
    restoreSelection(selectionToRestore);
    const html = '<table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table>';
    exec('insertHTML', html);
    const firstCell = editor.querySelector('table > tbody > tr > td, table > tbody > tr > th') as HTMLTableCellElement | null;
    if (firstCell) setSelectionInsideCell(firstCell);
    selectionRef.current = saveSelection();
    emitChange();
  }, [emitChange]);

  const insertImage = useCallback(() => {
    const url = window.prompt('Image URL');
    if (!url) return;
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection(selectionRef.current);
    editor.focus();
    exec('insertImage', url);
    selectionRef.current = saveSelection();
    emitChange();
  }, [emitChange]);

  const [tableToolbarPosition, setTableToolbarPosition] = useState({ top: 0, left: 0 });
  const [showTableToolbar, setShowTableToolbar] = useState(false);

  const applyTableMutation = useCallback((mutate: (tableInfo: TableCellInfo) => boolean | void) => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    const tableInfo = getTableCellInfo();
    if (!tableInfo || !isSupportedTable(tableInfo.table)) {
      setShowTableToolbar(false);
      return;
    }
    const shouldFallbackFocus = mutate(tableInfo) === true;
    if (shouldFallbackFocus) {
      focusSafeEditorLocation(editor);
    } else {
      editor.focus();
    }
    selectionRef.current = saveSelection();
    emitChange();
  }, [disabled, emitChange]);

  const addTableRow = useCallback((direction: 'before' | 'after') => {
    applyTableMutation((tableInfo) => {
      const { tbody, row } = tableInfo;
      const templateCells = Array.from(row.cells).map((currentCell) => {
        const nextCell = createEmptyTableCell(currentCell.tagName === 'TH' ? 'TH' : 'TD');
        const style = currentCell.getAttribute('style');
        if (style) nextCell.setAttribute('style', style);
        return nextCell;
      });
      if (!templateCells.length) return;
      const newRow = document.createElement('tr');
      templateCells.forEach((cell) => newRow.appendChild(cell));
      if (direction === 'before') tbody.insertBefore(newRow, row);
      else tbody.insertBefore(newRow, row.nextElementSibling);
      const targetCell = newRow.cells[Math.min(tableInfo.cellIndex, newRow.cells.length - 1)] as HTMLTableCellElement | undefined;
      if (targetCell) setSelectionInsideCell(targetCell);
      return false;
    });
  }, [applyTableMutation]);

  const removeTableRow = useCallback(() => {
    applyTableMutation((tableInfo) => {
      const { tbody, row, table } = tableInfo;
      if (tbody.rows.length <= 1) {
        table.remove();
        return true;
      }
      const nextRow = row.nextElementSibling as HTMLTableRowElement | null;
      const prevRow = row.previousElementSibling as HTMLTableRowElement | null;
      row.remove();
      const fallbackRow = nextRow ?? prevRow ?? tbody.rows[0] ?? null;
      const targetCell = fallbackRow?.cells[Math.min(tableInfo.cellIndex, fallbackRow.cells.length - 1)] as HTMLTableCellElement | undefined;
      if (targetCell) setSelectionInsideCell(targetCell);
      else focusSafeEditorLocation(tableInfo.table.closest('[contenteditable="true"]') as HTMLDivElement | null);
      return false;
    });
  }, [applyTableMutation]);

  const addTableColumn = useCallback((direction: 'before' | 'after') => {
    applyTableMutation((tableInfo) => {
      const rows = Array.from(tableInfo.tbody.rows);
      rows.forEach((currentRow) => {
        const referenceCell = currentRow.cells[tableInfo.cellIndex] ?? null;
        const newCell = createEmptyTableCell(referenceCell?.tagName === 'TH' ? 'TH' : 'TD');
        if (referenceCell && direction === 'before') currentRow.insertBefore(newCell, referenceCell);
        else currentRow.insertBefore(newCell, referenceCell ? referenceCell.nextElementSibling : null);
      });
      const targetRow = tableInfo.tbody.rows[tableInfo.rowIndex];
      const targetCell = targetRow?.cells[direction === 'before' ? tableInfo.cellIndex : tableInfo.cellIndex + 1] as HTMLTableCellElement | undefined;
      if (targetCell) setSelectionInsideCell(targetCell);
      return false;
    });
  }, [applyTableMutation]);

  const removeTableColumn = useCallback(() => {
    applyTableMutation((tableInfo) => {
      const rows = Array.from(tableInfo.tbody.rows);
      if (rows[0]?.cells.length <= 1) {
        tableInfo.table.remove();
        return true;
      }
      rows.forEach((currentRow) => {
        const cell = currentRow.cells[tableInfo.cellIndex];
        cell?.remove();
      });
      const targetRow = tableInfo.tbody.rows[Math.min(tableInfo.rowIndex, tableInfo.tbody.rows.length - 1)];
      const targetCell = targetRow?.cells[Math.min(tableInfo.cellIndex, Math.max(0, targetRow.cells.length - 1))] as HTMLTableCellElement | undefined;
      if (targetCell) setSelectionInsideCell(targetCell);
      else focusSafeEditorLocation(tableInfo.table.closest('[contenteditable="true"]') as HTMLDivElement | null);
      return false;
    });
  }, [applyTableMutation]);

  const removeTable = useCallback(() => {
    applyTableMutation((tableInfo) => {
      tableInfo.table.remove();
      return true;
    });
  }, [applyTableMutation]);

  const updateTableToolbarPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const info = getTableCellInfo();
    if (!info) {
      setShowTableToolbar(false);
      return;
    }
    const rect = info.cell.getBoundingClientRect();
    const width = 322;
    let left = rect.left;
    let top = rect.top - 46;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (top < 12) top = rect.bottom + 10;
    setTableToolbarPosition({ top: Math.max(12, top), left: Math.max(12, left) });
    setShowTableToolbar(true);
  }, []);

  const applyFontFamily = useCallback((family: FontFamily) => {
    const map: Record<FontFamily, string> = { inter: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'SFMono-Regular, Consolas, monospace' };
    run('fontName', map[family]);
    setActiveFontFamily(family);
  }, [run]);

  const applyFontSize = useCallback((size: FontSize) => {
    const map: Record<FontSize, string> = { sm: '2', base: '3', lg: '4' };
    run('fontSize', map[size]);
    setActiveFontSize(size);
  }, [run]);

  const insertSlashItem = useCallback((itemId: SlashItemId) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const activeRange = slashCommandRangeRef.current ?? selectionRef.current;
    restoreSelection(activeRange);
    const selection = window.getSelection();
    if (selection && slashCommandRangeRef.current) {
      selection.removeAllRanges();
      selection.addRange(slashCommandRangeRef.current);
    }
    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-GB');
    const id = `${itemId}-${Math.random().toString(36).slice(2, 10)}`;
    let html = '';
    if (itemId === 'task') html = createNoteRowHtml('task', id);
    if (itemId === 'decision') html = createNoteRowHtml('decision', id);
    if (itemId === 'log') html = createNoteRowHtml('log', id, `<span>${formattedDate}</span>`);
    if (itemId === 'date') html = `<span data-note-type="date" data-note-id="${id}" data-note-meta="date">${formattedDate}</span>&nbsp;`;
    exec('insertHTML', html);
    selectionRef.current = saveSelection();
    emitChange();
    closeSlashMenu();
  }, [closeSlashMenu, emitChange]);

  const inspectSlashTrigger = useCallback(() => {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      closeSlashMenu();
      return;
    }
    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    if (container.nodeType !== Node.TEXT_NODE) {
      closeSlashMenu();
      return;
    }
    const text = container.textContent || '';
    const before = text.slice(0, range.startOffset);
    const match = before.match(/(?:^|\s)\/([^\s\/]*)$/);
    if (!match || match.index === undefined) {
      closeSlashMenu();
      return;
    }
    const slashStart = match.index + match[0].indexOf('/');
    const commandRange = range.cloneRange();
    commandRange.setStart(container, slashStart);
    commandRange.setEnd(container, range.startOffset);
    slashCommandRangeRef.current = commandRange.cloneRange();
    setSlashQuery(match[1] || '');
    setShowSlashMenu(true);
    setSlashIndex(0);
    selectionRef.current = saveSelection();
    updateSlashMenuPosition();
  }, [closeSlashMenu, updateSlashMenuPosition]);

  const onInput = useCallback(() => {
    if (isComposingRef.current) return;
    selectionRef.current = saveSelection();
    emitChange();
    inspectSlashTrigger();
  }, [emitChange, inspectSlashTrigger]);

  const colorOptions = useMemo(() => ([
    'var(--nebula-900)',
    'var(--nebula-800)',
    'var(--nebula-600)',
    'var(--nebula-500)',
    '#0f172a',
    '#475569',
    '#e2e8f0',
    '#ffffff',
  ]), []);

  const applyColor = useCallback((color: string) => {
    if (!activeColorTarget) return;
    run(activeColorTarget === 'text' ? 'foreColor' : 'hiliteColor', color);
    setShowColorPicker(false);
  }, [activeColorTarget, run]);

  useEffect(() => {
    if (!showSlashMenu) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (slashMenuRef.current && target && !slashMenuRef.current.contains(target) && editorRef.current && !editorRef.current.contains(target)) {
        closeSlashMenu();
      }
    };
    const handleSelectionChange = () => {
      if (!editorRef.current) return;
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode;
      if (!anchorNode || !editorRef.current.contains(anchorNode)) {
        closeSlashMenu();
      } else {
        updateSlashMenuPosition();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('resize', updateSlashMenuPosition);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('resize', updateSlashMenuPosition);
    };
  }, [closeSlashMenu, showSlashMenu, updateSlashMenuPosition]);

  useEffect(() => {
    updateTableToolbarPosition();
    const handleSelectionChange = () => updateTableToolbarPosition();
    const handleScroll = () => updateTableToolbarPosition();
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [updateTableToolbarPosition]);

  useEffect(() => {
    if (!showColorPicker) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (colorPickerRef.current && target && !colorPickerRef.current.contains(target)) {
        setShowColorPicker(false);
      }
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

  return (
    <div className={`flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden border-0 bg-white shadow-none dark:bg-slate-950 ${className}`.trim()}>
      <div className={`shrink-0 flex flex-wrap items-center gap-2 border-b border-nebula-100/70 bg-white px-3 py-2 backdrop-blur-sm dark:border-slate-800/90 dark:bg-slate-900/88 ${toolbarClassName}`.trim()} onMouseDown={(e) => e.preventDefault()}>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-inner shadow-white/60 dark:border-slate-700 dark:bg-slate-900/80 dark:shadow-black/20">
          <button type="button" className={`${ICON_BUTTON_CLASS} ${activeMarks.bold ? ACTIVE_BUTTON_CLASS : ''}`} aria-pressed={activeMarks.bold} disabled={disabled} onClick={() => run('bold')} aria-label="Bold" title="Bold"><span className="font-bold">B</span></button>
          <button type="button" className={`${ICON_BUTTON_CLASS} ${activeMarks.italic ? ACTIVE_BUTTON_CLASS : ''}`} aria-pressed={activeMarks.italic} disabled={disabled} onClick={() => run('italic')} aria-label="Italic" title="Italic"><span className="italic">I</span></button>
          <button type="button" className={`${ICON_BUTTON_CLASS} ${activeMarks.underline ? ACTIVE_BUTTON_CLASS : ''}`} aria-pressed={activeMarks.underline} disabled={disabled} onClick={() => run('underline')} aria-label="Underline" title="Underline"><span className="underline">U</span></button>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-nebula-100/75 bg-white p-1 shadow-inner shadow-white/60 dark:border-slate-700 dark:bg-slate-800/80 dark:shadow-black/20">
          <button type="button" className={`${BUTTON_CLASS} ${activeBlock === 'p' ? ACTIVE_BUTTON_CLASS : ''}`} aria-pressed={activeBlock === 'p'} disabled={disabled} onClick={() => run('formatBlock', 'p')} aria-label="Normal text" title="Normal text">Aa</button>
          <button type="button" className={`${BUTTON_CLASS} ${activeBlock === 'h1' ? ACTIVE_BUTTON_CLASS : ''}`} aria-pressed={activeBlock === 'h1'} disabled={disabled} onClick={() => run('formatBlock', 'h1')} aria-label="Heading 1" title="Heading 1">H1</button>
          <button type="button" className={`${BUTTON_CLASS} ${activeBlock === 'h2' ? ACTIVE_BUTTON_CLASS : ''}`} aria-pressed={activeBlock === 'h2'} disabled={disabled} onClick={() => run('formatBlock', 'h2')} aria-label="Heading 2" title="Heading 2">H2</button>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-nebula-100/75 bg-white p-1 shadow-inner shadow-white/60 dark:border-slate-700 dark:bg-slate-800/80 dark:shadow-black/20">
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
            <option value="inter">Sans</option>
            <option value="serif">Serif</option>
            <option value="mono">Mono</option>
          </select>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-nebula-100/75 bg-white p-1 shadow-inner shadow-white/60 dark:border-slate-700 dark:bg-slate-800/80 dark:shadow-black/20">
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
        <div className="mx-1 hidden h-7 w-px bg-nebula-100/90 sm:block" aria-hidden="true" />
        <button type="button" className={ICON_BUTTON_CLASS} disabled={disabled} onClick={insertTable} aria-label="Insert table" title="Insert table"><span aria-hidden="true">▦</span></button>
        <button type="button" className={ICON_BUTTON_CLASS} disabled={disabled} onClick={insertImage} aria-label="Insert image" title="Insert image"><span aria-hidden="true">🖼</span></button>
        <button type="button" className={`${ICON_BUTTON_CLASS} ${activeBlock === 'ul' ? 'border-nebula-500/45 bg-nebula-50 text-nebula-800 dark:border-nebula-400/40 dark:bg-nebula-500/15 dark:text-nebula-100' : ''}`} aria-pressed={activeBlock === 'ul'} disabled={disabled} onClick={() => run('insertUnorderedList')} aria-label="Bullet list" title="Bullet list"><span aria-hidden="true">•</span></button>
        <button type="button" className={`${ICON_BUTTON_CLASS} ${activeBlock === 'ol' ? 'border-nebula-500/45 bg-nebula-50 text-nebula-800 dark:border-nebula-400/40 dark:bg-nebula-500/15 dark:text-nebula-100' : ''}`} aria-pressed={activeBlock === 'ol'} disabled={disabled} onClick={() => run('insertOrderedList')} aria-label="Numbered list" title="Numbered list"><span aria-hidden="true">1.</span></button>
        <div className="relative ml-auto" ref={colorPickerRef}>
          <button
            type="button"
            className={`${ICON_BUTTON_CLASS} ${activeColorTarget === 'text' ? 'border-nebula-500/45 bg-nebula-50 text-nebula-800 dark:border-nebula-400/40 dark:bg-nebula-500/15 dark:text-nebula-100 dark:hover:bg-nebula-500/20 dark:active:bg-nebula-500/25' : ''}`}
            disabled={disabled}
            onClick={() => {
              setActiveColorTarget('text');
              setShowColorPicker((v) => !v);
            }}
            aria-haspopup="menu"
            aria-expanded={showColorPicker}
            aria-label="Text color"
            title="Text color"
          >
            <span aria-hidden="true">A</span>
          </button>
          {showColorPicker && (
            <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-2xl border border-nebula-100/80 bg-white p-3 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.22)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_24px_48px_-28px_rgba(0,0,0,0.6)]">
              <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Text & highlight</div>
              <div className="grid grid-cols-4 gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="h-8 w-8 rounded-lg border border-nebula-100 shadow-sm ring-offset-1 ring-offset-white transition hover:scale-105 dark:border-slate-700 dark:ring-offset-slate-900"
                    style={{ backgroundColor: color }}
                    disabled={disabled}
                    aria-label={`Apply color ${color}`}
                    onClick={() => applyColor(color)}
                  />
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" className={`${BUTTON_CLASS} ${activeColorTarget === 'text' ? 'border-nebula-500/45 bg-nebula-50 text-nebula-800' : ''}`} disabled={disabled} onClick={() => setActiveColorTarget('text')}>
                  Text
                </button>
                <button type="button" className={`${BUTTON_CLASS} ${activeColorTarget === 'highlight' ? 'border-nebula-500/45 bg-nebula-50 text-nebula-800' : ''}`} disabled={disabled} onClick={() => setActiveColorTarget('highlight')}>
                  Highlight
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-1 min-h-0 min-w-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.92),_rgba(248,250,252,0.98)_42%,_rgba(241,245,249,1)_100%)] dark:bg-[radial-gradient(circle_at_top,_rgba(30,41,59,0.55),_rgba(15,23,42,0.95)_42%,_rgba(2,6,23,1)_100%)]">
        <div className="flex flex-1 min-h-0 min-w-0 border-0 bg-white shadow-none dark:bg-slate-900">
          <div
            ref={editorRef}
            contentEditable={!disabled}
            dir="ltr"
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            data-placeholder={placeholder}
            onInput={onInput}
            onPaste={(event) => {
              if (disabled) return;
              // Without this the browser inserts the source's markup verbatim,
              // styles and wrapper spans included. Shift+paste forces plain text.
              event.preventDefault();
              const clipboard = event.clipboardData;
              if (!clipboard) return;
              const asHtml = clipboard.getData('text/html');
              const asText = clipboard.getData('text/plain');
              const payload =
                asHtml && !plainPasteRef.current
                  ? sanitizePastedHtml(asHtml)
                  : escapeHtml(asText).replace(/\r?\n/g, '<br />');
              document.execCommand('insertHTML', false, payload);
              emitChange();
            }}
            onClick={(event) => {
              const target = event.target as HTMLElement | null;
              const toggle = target?.closest('[data-note-task-toggle="true"]') as HTMLButtonElement | null;
              if (!toggle || disabled) return;
              const noteRow = toggle.closest('p[data-note-type="task"]') as HTMLElement | null;
              if (!noteRow) return;
              event.preventDefault();
              event.stopPropagation();
              updateTaskRowCompletion(noteRow, noteRow.getAttribute('data-task-completed') !== 'true');
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
            onKeyDown={(event) => {
              const noteContext = getNoteRowContext();
              if (noteContext && noteContext.noteType === 'log' && event.key === 'Backspace' && isNoteContentVisuallyEmpty(noteContext.content)) {
                const caretOffset = getCaretOffsetWithin(noteContext.content, noteContext.selection);
                if (caretOffset === 0) {
                  event.preventDefault();
                  const paragraph = unwrapNoteRowToParagraph(noteContext.noteBlock);
                  emitChange();
                  if (paragraph) ensureCaretInsideNoteContent(paragraph, 'end');
                  selectionRef.current = saveSelection();
                  return;
                }
              }
              const shouldRedirectProtectedNoteRegion = !!noteContext && (noteContext.withinLeading || noteContext.withinTrailing)
                && (!event.ctrlKey && !event.metaKey && !event.altKey)
                && (event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete' || event.key.length === 1);
              if (shouldRedirectProtectedNoteRegion && noteContext) {
                event.preventDefault();
                ensureCaretInsideNoteContent(noteContext.content, event.key === 'Backspace' ? 'end' : 'start');
                selectionRef.current = saveSelection();
                return;
              }
              if (noteContext && (event.key === 'Backspace' || event.key === 'Delete')) {
                const caretOffset = getCaretOffsetWithin(noteContext.content, noteContext.selection);
                const contentText = noteContext.content.textContent ?? '';
                const contentLength = contentText.replace(/ /g, '').length;
                const isEmptyNote = isNoteContentVisuallyEmpty(noteContext.content);
                if (isEmptyNote && event.key === 'Backspace' && caretOffset === 0) {
                  event.preventDefault();
                  const paragraph = noteContext.noteType === 'task'
                    ? convertTaskRowToParagraph(noteContext.noteBlock)
                    : unwrapNoteRowToParagraph(noteContext.noteBlock);
                  emitChange();
                  if (paragraph) ensureCaretInsideNoteContent(paragraph, 'end');
                  selectionRef.current = saveSelection();
                  return;
                }
                if (noteContext.noteType === 'task' && ((event.key === 'Backspace' && caretOffset === 0) || (event.key === 'Delete' && caretOffset >= contentLength))) {
                  event.preventDefault();
                  return;
                }
              }
              if (showSlashMenu) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSlashIndex((current) => (filteredSlashItems.length ? (current + 1) % filteredSlashItems.length : 0));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSlashIndex((current) => (filteredSlashItems.length ? (current - 1 + filteredSlashItems.length) % filteredSlashItems.length : 0));
                  return;
                }
                if (event.key === 'Enter') {
                  const item = filteredSlashItems[slashIndex];
                  if (item) {
                    event.preventDefault();
                    insertSlashItem(item.id);
                  }
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeSlashMenu();
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                if (noteContext) {
                  event.preventDefault();
                  const id = `${noteContext.noteType}-${Math.random().toString(36).slice(2, 10)}`;
                  const html = noteContext.noteType === 'log'
                    ? createNoteRowHtml('log', id, `<span>${new Date().toLocaleDateString('en-GB')}</span>`)
                    : createNoteRowHtml(noteContext.noteType, id);
                  const insertedRow = insertNoteRowAfter(noteContext.noteBlock, html);
                  emitChange();
                  const nextRowContent = insertedRow?.querySelector('[data-note-content]') as HTMLElement | null;
                  if (nextRowContent) requestAnimationFrame(() => ensureCaretInsideNoteContent(nextRowContent, 'start'));
                  selectionRef.current = saveSelection();
                  return;
                }
                event.preventDefault();
                exec('insertParagraph');
                emitChange();
              }
            }}
            onBlur={() => {
              const noteRows = editorRef.current?.querySelectorAll('p[data-note-type]') ?? [];
              noteRows.forEach((row) => normalizeNoteContentPlaceholder(row as HTMLElement));
              selectionRef.current = saveSelection();
              emitChange();
              window.setTimeout(() => closeSlashMenu(), 120);
            }}
            className={`flex-1 min-h-0 w-full min-w-0 px-4 py-4 text-[15px] leading-8 text-slate-800 outline-none overflow-y-auto [direction:ltr] [text-align:left] [unicode-bidi:isolate] empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 dark:text-slate-100 dark:empty:before:text-slate-500 [&_h1]:mb-4 [&_h1]:text-[2rem] [&_h1]:leading-tight [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:text-[1.35rem] [&_h2]:leading-snug [&_h2]:font-semibold [&_ul]:ml-6 [&_ul]:list-disc [&_ol]:ml-6 [&_ol]:list-decimal [&_[data-note-type]]:mb-2 [&_[data-note-type]]:rounded-md [&_[data-note-type]]:border [&_[data-note-type]]:border-slate-100/70 [&_[data-note-type]]:bg-transparent [&_[data-note-type]]:px-1.5 [&_[data-note-type]]:py-0.5 [&_[data-note-type]]:shadow-none [&_[data-note-type]]:font-normal [&_[data-note-type]]:leading-6 [&_[data-note-type]]:cursor-text [&_[data-note-type='task']]:text-slate-800 [&_[data-note-type='decision']]:text-slate-800 [&_[data-note-type='log']]:text-slate-700 dark:[&_[data-note-type='task']]:text-slate-100 dark:[&_[data-note-type='decision']]:text-slate-100 dark:[&_[data-note-type='log']]:text-slate-200 [&_[data-note-type='task'][data-task-completed='true']]:italic [&_[data-note-type='decision']]:italic [&_[data-note-type='decision']_[data-note-content]]:not-italic [&_[data-note-type='log']]:not-italic [&_[data-note-type='log']_[data-note-content]]:not-italic [&_[data-note-type='log']_[data-note-meta]]:normal-case [&_[data-note-type]:hover]:border-slate-200/80 [&_[data-note-type]:hover]:bg-slate-50/50 [&_[data-note-type]:focus-within]:border-nebula-200 [&_[data-note-type]:focus-within]:bg-nebula-50/25 [&_[data-note-leading]]:self-center [&_[data-note-type='task']_[data-note-content],&_[data-note-type='decision']_[data-note-content],&_[data-note-type='log']_[data-note-content]]:min-h-[1.5rem] [&_[data-note-type='task']_[data-note-content],&_[data-note-type='decision']_[data-note-content],&_[data-note-type='log']_[data-note-content]]:flex-1 [&_[data-note-type='task']_[data-note-content],&_[data-note-type='decision']_[data-note-content],&_[data-note-type='log']_[data-note-content]]:outline-none [&_[data-note-type='task']_[data-note-content],&_[data-note-type='decision']_[data-note-content],&_[data-note-type='log']_[data-note-content]]:whitespace-pre-wrap [&_[data-note-type='task']_[data-note-content],&_[data-note-type='decision']_[data-note-content],&_[data-note-type='log']_[data-note-content]]:break-words [&_[data-note-type='task']_[data-note-content],&_[data-note-type='decision']_[data-note-content],&_[data-note-type='log']_[data-note-content]]:cursor-text [&_[data-note-trailing-meta]]:ml-auto [&_[data-note-trailing-meta]]:flex [&_[data-note-trailing-meta]]:items-center [&_[data-note-trailing-meta]]:justify-end [&_[data-note-trailing-meta]]:self-center [&_[data-note-trailing-meta]]:select-none [&_[data-note-trailing-meta]]:whitespace-nowrap dark:[&_[data-note-type]:hover]:border-slate-700/80 dark:[&_[data-note-type]:hover]:bg-slate-800/25 dark:[&_[data-note-type]:focus-within]:border-nebula-500/30 dark:[&_[data-note-type]:focus-within]:bg-nebula-500/8 [&_[data-note-type]_button:focus-visible]:ring-2 [&_[data-note-type]_button:focus-visible]:ring-nebula-500/25 [&_[data-note-type]_button:focus-visible]:ring-offset-1 [&_[data-note-type]_button:focus-visible]:ring-offset-white dark:[&_[data-note-type]_button:focus-visible]:ring-offset-slate-900 [&_table]:my-4 [&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_td]:border [&_td]:border-nebula-100 dark:[&_td]:border-slate-700 [&_td]:p-2 ${editorClassName}`.trim()}
          />
          {showTableToolbar && !disabled && (
            <div className="fixed z-30 flex items-center gap-1 rounded-xl border border-nebula-100/80 bg-white/98 p-1 shadow-[0_20px_36px_-24px_rgba(15,23,42,0.24)] backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/98 dark:shadow-[0_24px_44px_-28px_rgba(0,0,0,0.62)]" style={{ top: tableToolbarPosition.top, left: tableToolbarPosition.left }}>
              <button type="button" className={BUTTON_CLASS} onMouseDown={(event) => event.preventDefault()} onClick={() => addTableRow('before')} aria-label="Add row above" title="Add row above"><span className="font-medium">Row</span><span className="ml-1 text-nebula-600 dark:text-nebula-300">+↑</span></button>
              <button type="button" className={BUTTON_CLASS} onMouseDown={(event) => event.preventDefault()} onClick={() => addTableRow('after')} aria-label="Add row below" title="Add row below"><span className="font-medium">Row</span><span className="ml-1 text-nebula-600 dark:text-nebula-300">+↓</span></button>
              <button type="button" className={BUTTON_CLASS} onMouseDown={(event) => event.preventDefault()} onClick={() => removeTableRow()} aria-label="Remove row" title="Remove row"><span className="font-medium">Row</span><span className="ml-1 text-rose-600 dark:text-rose-300">−</span></button>
              <button type="button" className={BUTTON_CLASS} onMouseDown={(event) => event.preventDefault()} onClick={() => addTableColumn('before')} aria-label="Add column before" title="Add column before"><span className="font-medium">Col</span><span className="ml-1 text-nebula-600 dark:text-nebula-300">+←</span></button>
              <button type="button" className={BUTTON_CLASS} onMouseDown={(event) => event.preventDefault()} onClick={() => addTableColumn('after')} aria-label="Add column after" title="Add column after"><span className="font-medium">Col</span><span className="ml-1 text-nebula-600 dark:text-nebula-300">+→</span></button>
              <button type="button" className={BUTTON_CLASS} onMouseDown={(event) => event.preventDefault()} onClick={() => removeTableColumn()} aria-label="Remove column" title="Remove column"><span className="font-medium">Col</span><span className="ml-1 text-rose-600 dark:text-rose-300">−</span></button>
              <button type="button" className={BUTTON_CLASS} onMouseDown={(event) => event.preventDefault()} onClick={() => removeTable()} aria-label="Remove table" title="Remove table"><span className="text-rose-600 dark:text-rose-300">Del table</span></button>
            </div>
          )}

          {showSlashMenu && (
            <div
              ref={slashMenuRef}
              className="fixed z-30 w-64 rounded-xl border border-nebula-100/80 bg-white/98 p-2 shadow-[0_24px_40px_-24px_rgba(15,23,42,0.24)] backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/98 dark:shadow-[0_28px_46px_-26px_rgba(0,0,0,0.62)]"
              style={{ top: slashPosition.top, left: slashPosition.left }}
            >
              <div className="px-2 pb-2 text-[10px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Quick insert</div>
              <div className="space-y-1">
                {filteredSlashItems.length > 0 ? filteredSlashItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex w-full items-start justify-between rounded-lg px-3 py-2 text-left transition ${index === slashIndex ? 'bg-nebula-50 text-nebula-800 dark:bg-nebula-500/12 dark:text-nebula-100' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertSlashItem(item.id)}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">{item.id === 'task' ? <span aria-hidden="true">◯</span> : item.id === 'decision' ? <DecisionIcon className="h-4 w-4" /> : item.id === 'log' ? <LogIcon className="h-4 w-4" /> : <span aria-hidden="true">◌</span>}<span>{item.label}</span></span>
                    <span className="pl-3 text-[11px] text-[#9b866f]">{item.hint}</span>
                  </button>
                )) : (
                  <div className="rounded-lg px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No quick inserts</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RichNotesEditor;
