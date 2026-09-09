// The "/" command menu.
//
// What this replaces: a flat list of four items (task, decision, log, date)
// whose trigger only fired when the caret sat in a real text node -- so "/" at
// the start of an empty block did nothing -- and whose insertion handed an HTML
// string to execCommand('insertHTML') with the caret inside a paragraph, which
// forced the browser to break the host block and left orphaned empty
// paragraphs around the new row.
//
// Now: grouped commands, real nested submenus, a table size grid, matching on
// keywords as well as labels, and every command inserting through the block
// model in ./blocks so the result is the same in every browser.

import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BlockTag } from './blocks';
import { createDateChip, createNoteRow, newNoteRowId } from './noteRows';
import { createTable } from './tables';

export type EditorApi = {
  root: HTMLElement;
  insertBlock: (node: HTMLElement) => void;
  insertInline: (node: Node) => void;
  setBlockTag: (tag: BlockTag) => void;
  toggleList: (kind: 'ul' | 'ol') => void;
  askFor: (label: string) => string | null;
};

export type SlashAction = {
  kind: 'action';
  id: string;
  label: string;
  hint?: string;
  keywords: string[];
  icon: React.ReactNode;
  run: (api: EditorApi) => void;
};

export type SlashSubmenu = {
  kind: 'submenu';
  id: string;
  label: string;
  hint?: string;
  keywords: string[];
  icon: React.ReactNode;
  items: SlashNode[];
};

export type SlashGrid = {
  kind: 'grid';
  id: string;
  label: string;
  hint?: string;
  keywords: string[];
  icon: React.ReactNode;
  maxRows: number;
  maxColumns: number;
  run: (api: EditorApi, rows: number, columns: number) => void;
};

export type SlashNode = SlashAction | SlashSubmenu | SlashGrid;
export type SlashGroup = { label: string; items: SlashNode[] };

// --- icons -------------------------------------------------------------------

const Glyph = ({ children }: { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const TextGlyph = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-semibold" aria-hidden="true">
    {children}
  </span>
);

const IconText = <Glyph><path d="M5 6h14" /><path d="M5 12h14" /><path d="M5 18h9" /></Glyph>;
const IconHeading = <Glyph><path d="M6 4v16" /><path d="M18 4v16" /><path d="M6 12h12" /></Glyph>;
const IconBulleted = <Glyph><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="M4.5 6h.01" /><path d="M4.5 12h.01" /><path d="M4.5 18h.01" /></Glyph>;
const IconNumbered = <Glyph><path d="M10 6h10" /><path d="M10 12h10" /><path d="M10 18h10" /><path d="M4 5.5 5.5 5v4" /><path d="M4 12h2l-2 3h2.5" /><path d="M4 17h2v2H4z" /></Glyph>;
const IconQuote = <Glyph><path d="M5 5v14" /><path d="M10 8h9" /><path d="M10 13h9" /><path d="M10 18h5" /></Glyph>;
const IconCode = <Glyph><path d="m9 8-4 4 4 4" /><path d="m15 8 4 4-4 4" /></Glyph>;
const IconDivider = <Glyph><path d="M3 12h18" /><path d="M6 7h12" opacity="0.35" /><path d="M6 17h12" opacity="0.35" /></Glyph>;
const IconTask = <Glyph><path d="M4 6.5h5" /><path d="M4 17.5h5" /><rect x="4" y="4" width="5" height="5" rx="1.2" /><rect x="4" y="15" width="5" height="5" rx="1.2" /><path d="M12 6.5h8" /><path d="M12 17.5h8" /></Glyph>;
const IconDecision = <Glyph><path d="M12 22V13" /><path d="M12 13c0-3 2-4 4-6l3-3" /><path d="M12 13c0-3-2-4-4-6l-3-3" strokeDasharray="3 3" opacity="0.4" /><path d="M16 4h4v4" /></Glyph>;
const IconLog = <Glyph><path d="M7 4h7l3 3v13H7z" /><path d="M14 4v3h3" /><path d="M9 11h6" /><path d="M9 15h6" /></Glyph>;
const IconCallout = <Glyph><circle cx="12" cy="12" r="8.5" /><path d="M12 8h.01" /><path d="M12 11.5v4.5" /></Glyph>;
const IconTable = <Glyph><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M3.5 9.5h17" /><path d="M9.5 9.5v10" /><path d="M15 9.5v10" /></Glyph>;
const IconDate = <Glyph><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17" /><path d="M8 3.5v3" /><path d="M16 3.5v3" /></Glyph>;
const IconImage = <Glyph><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4.5 17.5 4.5-4 5 4.5" /><path d="m14 15 2.5-2.5 4 4" /></Glyph>;
const IconLink = <Glyph><path d="M10 13.5a4 4 0 0 0 5.66 0l2.84-2.84a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10.5a4 4 0 0 0-5.66 0L5.5 13.34a4 4 0 0 0 5.66 5.66l1-1" /></Glyph>;

// --- the command tree --------------------------------------------------------

const heading = (tag: 'h1' | 'h2' | 'h3', label: string): SlashAction => ({
  kind: 'action',
  id: tag,
  label,
  hint: tag.toUpperCase(),
  keywords: [tag, 'heading', 'title', `h${tag.slice(1)}`],
  icon: <TextGlyph>{tag.toUpperCase()}</TextGlyph>,
  run: (api) => api.setBlockTag(tag),
});

const noteRowCommand = (type: 'task' | 'decision' | 'log', label: string, hint: string, icon: React.ReactNode, keywords: string[]): SlashAction => ({
  kind: 'action',
  id: type,
  label,
  hint,
  keywords,
  icon,
  run: (api) => api.insertBlock(createNoteRow(type, { id: newNoteRowId(type) })),
});

const callout = (variant: 'info' | 'warn' | 'error' | 'success', label: string): SlashAction => ({
  kind: 'action',
  id: `callout-${variant}`,
  label,
  hint: 'Callout',
  keywords: ['callout', 'admonition', 'aside', variant, label.toLowerCase()],
  icon: <span className={`inline-flex h-4 w-4 shrink-0 rounded-full border-2 zero-note-callout-swatch-${variant}`} aria-hidden="true" />,
  run: (api) => {
    const block = document.createElement('div');
    block.setAttribute('data-callout', variant);
    block.appendChild(document.createElement('br'));
    api.insertBlock(block);
  },
});

const dateCommand = (id: string, label: string, offsetDays: number): SlashAction => ({
  kind: 'action',
  id,
  label,
  hint: 'Date',
  keywords: ['date', 'today', 'yesterday', label.toLowerCase()],
  icon: IconDate,
  run: (api) => {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    api.insertInline(createDateChip(date));
    api.insertInline(document.createTextNode(' '));
  },
});

export const SLASH_GROUPS: SlashGroup[] = [
  {
    label: 'Basic',
    items: [
      {
        kind: 'action',
        id: 'text',
        label: 'Normal text',
        hint: 'Paragraph',
        keywords: ['text', 'paragraph', 'body', 'plain'],
        icon: IconText,
        run: (api) => api.setBlockTag('p'),
      },
      {
        kind: 'submenu',
        id: 'heading',
        label: 'Heading',
        hint: 'H1 – H3',
        // Deliberately not h1/h2/h3: those belong to the children, and a
        // parent that also matched them outranked them in the flat search.
        keywords: ['heading', 'title', 'section'],
        icon: IconHeading,
        items: [heading('h1', 'Heading 1'), heading('h2', 'Heading 2'), heading('h3', 'Heading 3')],
      },
      {
        kind: 'action',
        id: 'ul',
        label: 'Bullet list',
        hint: 'Unordered',
        keywords: ['bullet', 'list', 'unordered', 'ul'],
        icon: IconBulleted,
        run: (api) => api.toggleList('ul'),
      },
      {
        kind: 'action',
        id: 'ol',
        label: 'Numbered list',
        hint: 'Ordered',
        keywords: ['numbered', 'list', 'ordered', 'ol'],
        icon: IconNumbered,
        run: (api) => api.toggleList('ol'),
      },
      {
        kind: 'action',
        id: 'quote',
        label: 'Quote',
        hint: 'Blockquote',
        keywords: ['quote', 'blockquote', 'citation'],
        icon: IconQuote,
        run: (api) => api.setBlockTag('blockquote'),
      },
      {
        kind: 'action',
        id: 'pre',
        label: 'Code block',
        hint: 'Monospace',
        keywords: ['code', 'pre', 'snippet', 'monospace'],
        icon: IconCode,
        run: (api) => api.setBlockTag('pre'),
      },
      {
        kind: 'action',
        id: 'hr',
        label: 'Divider',
        hint: 'Rule',
        keywords: ['divider', 'rule', 'hr', 'separator', 'line'],
        icon: IconDivider,
        run: (api) => api.insertBlock(document.createElement('hr')),
      },
    ],
  },
  {
    label: 'Notes',
    items: [
      noteRowCommand('task', 'Task', 'Checkbox row', IconTask, ['task', 'todo', 'checkbox', 'action']),
      noteRowCommand('decision', 'Decision', 'Decision marker', IconDecision, ['decision', 'choice', 'call']),
      noteRowCommand('log', 'Log', 'Dated entry', IconLog, ['log', 'journal', 'entry', 'dated']),
      {
        kind: 'submenu',
        id: 'callout',
        label: 'Callout',
        hint: '4 kinds',
        keywords: ['callout', 'admonition', 'aside'],
        icon: IconCallout,
        items: [callout('info', 'Info'), callout('warn', 'Warning'), callout('error', 'Error'), callout('success', 'Success')],
      },
    ],
  },
  {
    label: 'Insert',
    items: [
      {
        kind: 'grid',
        id: 'table',
        label: 'Table',
        hint: 'Pick a size',
        keywords: ['table', 'grid', 'rows', 'columns'],
        icon: IconTable,
        maxRows: 6,
        maxColumns: 6,
        run: (api, rows, columns) => api.insertBlock(createTable(rows, columns)),
      },
      {
        kind: 'submenu',
        id: 'date',
        label: 'Date',
        hint: 'Today / pick',
        keywords: ['date', 'day', 'calendar'],
        icon: IconDate,
        items: [
          dateCommand('date-today', 'Today', 0),
          dateCommand('date-yesterday', 'Yesterday', -1),
          {
            kind: 'action',
            id: 'date-pick',
            label: 'Pick a date…',
            hint: 'YYYY-MM-DD',
            keywords: ['date', 'pick', 'choose', 'custom'],
            icon: IconDate,
            run: (api) => {
              const raw = api.askFor('Date (YYYY-MM-DD)');
              if (!raw) return;
              const parsed = new Date(raw);
              if (Number.isNaN(parsed.getTime())) return;
              api.insertInline(createDateChip(parsed));
              api.insertInline(document.createTextNode(' '));
            },
          },
        ],
      },
      {
        kind: 'action',
        id: 'image',
        label: 'Image',
        hint: 'From URL',
        keywords: ['image', 'picture', 'photo', 'img'],
        icon: IconImage,
        run: (api) => {
          const url = api.askFor('Image URL');
          if (!url) return;
          const wrapper = document.createElement('p');
          const image = document.createElement('img');
          image.src = url;
          image.alt = '';
          wrapper.appendChild(image);
          api.insertBlock(wrapper);
        },
      },
      {
        kind: 'action',
        id: 'link',
        label: 'Link',
        hint: 'From URL',
        keywords: ['link', 'url', 'anchor', 'href'],
        icon: IconLink,
        run: (api) => {
          const url = api.askFor('Link URL');
          if (!url) return;
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.textContent = api.askFor('Link text') || url;
          api.insertInline(anchor);
          api.insertInline(document.createTextNode(' '));
        },
      },
    ],
  },
];

// --- resolving what to show --------------------------------------------------

export type MenuRow = { node: SlashNode; trail?: string };
export type MenuSection = { label: string | null; rows: MenuRow[] };
export type MenuView = {
  title: string | null;
  sections: MenuSection[];
  rows: MenuRow[];
  grid: SlashGrid | null;
};

function nodeAt(path: string[]): SlashNode | null {
  let items: SlashNode[] = SLASH_GROUPS.flatMap((group) => group.items);
  let found: SlashNode | null = null;
  for (const id of path) {
    found = items.find((item) => item.id === id) ?? null;
    if (!found) return null;
    items = found.kind === 'submenu' ? found.items : [];
  }
  return found;
}

function matches(node: SlashNode, query: string): boolean {
  if (node.label.toLowerCase().includes(query)) return true;
  return node.keywords.some((keyword) => keyword.toLowerCase().includes(query));
}

/**
 * Search runs across every level, so `/h2` finds Heading 2 without walking into
 * the submenu -- the old menu only ever matched `label` on its four flat items.
 */
function searchRows(query: string): MenuRow[] {
  const rows: MenuRow[] = [];
  const visit = (nodes: SlashNode[], trail: string | undefined) => {
    for (const node of nodes) {
      if (matches(node, query)) rows.push({ node, trail });
      if (node.kind === 'submenu') visit(node.items, node.label);
    }
  };
  for (const group of SLASH_GROUPS) visit(group.items, undefined);
  return rows;
}

export function resolveMenuView(path: string[], query: string): MenuView {
  const trimmed = query.trim().toLowerCase();
  const current = path.length ? nodeAt(path) : null;

  if (current?.kind === 'grid') {
    return { title: current.label, sections: [], rows: [], grid: current };
  }

  if (trimmed) {
    const rows = searchRows(trimmed);
    return { title: null, sections: [{ label: null, rows }], rows, grid: null };
  }

  if (current?.kind === 'submenu') {
    const rows = current.items.map((node) => ({ node }));
    return { title: current.label, sections: [{ label: null, rows }], rows, grid: null };
  }

  const sections = SLASH_GROUPS.map((group) => ({
    label: group.label,
    rows: group.items.map((node) => ({ node })),
  }));
  return { title: null, sections, rows: sections.flatMap((section) => section.rows), grid: null };
}

// --- navigation state --------------------------------------------------------

export type SlashMenuController = {
  open: boolean;
  query: string;
  path: string[];
  index: number;
  view: MenuView;
  grid: { rows: number; columns: number };
  setQuery: (query: string) => void;
  setIndex: (index: number) => void;
  setGrid: (size: { rows: number; columns: number }) => void;
  openAt: (query: string) => void;
  close: () => void;
  /** Leave the current submenu, closing the menu when already at the root. */
  back: () => void;
  /** Returns true when the key was consumed and the editor must not act on it. */
  handleKeyDown: (event: React.KeyboardEvent | KeyboardEvent, api: EditorApi, onRun: () => void) => boolean;
  activate: (row: MenuRow, api: EditorApi, onRun: () => void) => void;
};

export function useSlashMenu(): SlashMenuController {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [path, setPath] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [grid, setGrid] = useState({ rows: 3, columns: 3 });

  const view = useMemo(() => resolveMenuView(path, query), [path, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setPath([]);
    setIndex(0);
    setGrid({ rows: 3, columns: 3 });
  }, []);

  const back = useCallback(() => {
    setIndex(0);
    setPath((current) => {
      if (!current.length) {
        setOpen(false);
        setQuery('');
        return current;
      }
      return current.slice(0, -1);
    });
  }, []);

  const openAt = useCallback((nextQuery: string) => {
    setOpen(true);
    setQuery(nextQuery);
    setIndex(0);
  }, []);

  const activate = useCallback((row: MenuRow, api: EditorApi, onRun: () => void) => {
    const { node } = row;
    if (node.kind === 'submenu' || node.kind === 'grid') {
      setPath((current) => [...current, node.id]);
      setQuery('');
      setIndex(0);
      return;
    }
    onRun();
    node.run(api);
    close();
  }, [close]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent | KeyboardEvent, api: EditorApi, onRun: () => void): boolean => {
    if (!open) return false;
    const stop = () => event.preventDefault();

    if (view.grid) {
      const size = view.grid;
      switch (event.key) {
        case 'ArrowRight':
          stop();
          setGrid((current) => ({ ...current, columns: Math.min(size.maxColumns, current.columns + 1) }));
          return true;
        case 'ArrowLeft':
          stop();
          if (grid.columns <= 1) setPath((current) => current.slice(0, -1));
          else setGrid((current) => ({ ...current, columns: current.columns - 1 }));
          return true;
        case 'ArrowDown':
          stop();
          setGrid((current) => ({ ...current, rows: Math.min(size.maxRows, current.rows + 1) }));
          return true;
        case 'ArrowUp':
          stop();
          setGrid((current) => ({ ...current, rows: Math.max(1, current.rows - 1) }));
          return true;
        case 'Enter':
        case 'Tab':
          stop();
          onRun();
          size.run(api, grid.rows, grid.columns);
          close();
          return true;
        case 'Escape':
          stop();
          setPath((current) => current.slice(0, -1));
          return true;
        default:
          return false;
      }
    }

    const rows = view.rows;
    switch (event.key) {
      case 'ArrowDown':
        stop();
        setIndex((current) => (rows.length ? (current + 1) % rows.length : 0));
        return true;
      case 'ArrowUp':
        stop();
        setIndex((current) => (rows.length ? (current - 1 + rows.length) % rows.length : 0));
        return true;
      case 'ArrowRight': {
        const row = rows[index];
        if (!row || row.node.kind === 'action') return false;
        stop();
        activate(row, api, onRun);
        return true;
      }
      case 'ArrowLeft':
        if (!path.length) return false;
        stop();
        setPath((current) => current.slice(0, -1));
        setIndex(0);
        return true;
      case 'Enter':
      case 'Tab': {
        const row = rows[index];
        if (!row) return false;
        stop();
        activate(row, api, onRun);
        return true;
      }
      case 'Escape':
        stop();
        if (path.length) {
          setPath((current) => current.slice(0, -1));
          setIndex(0);
        } else {
          close();
        }
        return true;
      default:
        return false;
    }
  }, [activate, close, grid.columns, grid.rows, index, open, path.length, view]);

  return {
    open,
    query,
    path,
    index,
    view,
    grid,
    setQuery,
    setIndex,
    setGrid,
    openAt,
    close,
    back,
    handleKeyDown,
    activate,
  };
}

// --- presentation ------------------------------------------------------------

const ROW_BASE = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors';
const ROW_IDLE = 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70';
const ROW_ACTIVE = 'border border-nebula-500 bg-nebula-500/10 text-nebula-900 dark:text-white';
const ROW_INACTIVE_BORDER = 'border border-transparent';

export type SlashMenuProps = {
  controller: SlashMenuController;
  position: { top: number; left: number };
  menuRef: React.RefObject<HTMLDivElement>;
  onActivate: (row: MenuRow) => void;
  onActivateGrid: (rows: number, columns: number) => void;
  onBack: () => void;
};

export function SlashMenu({ controller, position, menuRef, onActivate, onActivateGrid, onBack }: SlashMenuProps) {
  const { view, index, grid, setIndex, setGrid } = controller;
  if (typeof document === 'undefined') return null;

  // Only a submenu gets a header: at the root the group labels already say
  // what each section is, and a second "Insert" above the Insert group read as
  // a duplicate.
  const header = view.title ? (
    <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-500">
      <button
        type="button"
        className="rounded px-1 text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-slate-100"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onBack}
        aria-label="Back"
      >
        &lsaquo;
      </button>
      <span>{view.title}</span>
    </div>
  ) : null;

  const body = view.grid ? (
    <div className="px-1 pb-1">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${view.grid.maxColumns}, 1.125rem)` }}
        role="presentation"
      >
        {Array.from({ length: view.grid.maxRows }).flatMap((_, rowIndex) =>
          Array.from({ length: view.grid!.maxColumns }).map((__, columnIndex) => {
            const active = rowIndex < grid.rows && columnIndex < grid.columns;
            return (
              <button
                key={`${rowIndex}-${columnIndex}`}
                type="button"
                className={`h-[1.125rem] w-[1.125rem] rounded-[3px] border transition-colors ${
                  active
                    ? 'border-nebula-500 bg-nebula-500/30'
                    : 'border-slate-300 bg-transparent dark:border-slate-700'
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setGrid({ rows: rowIndex + 1, columns: columnIndex + 1 })}
                onClick={() => onActivateGrid(rowIndex + 1, columnIndex + 1)}
                aria-label={`Insert ${rowIndex + 1} by ${columnIndex + 1} table`}
              />
            );
          }),
        )}
      </div>
      <div className="pt-2 text-[11px] text-slate-500 dark:text-slate-400">
        {grid.rows} × {grid.columns} &middot; arrows resize, Enter inserts
      </div>
    </div>
  ) : (
    <div role="listbox" aria-label="Insert">
      {view.rows.length === 0 && (
        <div className="rounded-md px-2 py-2 text-xs text-slate-500 dark:text-slate-400">No matching command</div>
      )}
      {view.sections.map((section, sectionIndex) => (
        <div key={section.label ?? `section-${sectionIndex}`} className={sectionIndex ? 'pt-1.5' : ''}>
          {section.label && (
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600">
              {section.label}
            </div>
          )}
          {section.rows.map((row) => {
            const rowIndex = view.rows.indexOf(row);
            const isActive = rowIndex === index;
            const isBranch = row.node.kind !== 'action';
            return (
              <button
                key={`${row.trail ?? ''}${row.node.id}`}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`${ROW_BASE} ${isActive ? ROW_ACTIVE : `${ROW_INACTIVE_BORDER} ${ROW_IDLE}`}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setIndex(rowIndex)}
                onClick={() => onActivate(row)}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500 dark:text-slate-400">
                  {row.node.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {row.trail && <span className="text-slate-400 dark:text-slate-500">{row.trail} › </span>}
                  {row.node.label}
                </span>
                <span className="shrink-0 pl-2 text-[10px] uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                  {isBranch ? '›' : row.node.hint}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  // Portalled to the body: the canvas shell animates `transform` on its
  // columns, and a transformed ancestor becomes the containing block for
  // position: fixed, which used to drag this menu away from the caret.
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[70] w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-[#3e3e3e] dark:bg-[#252526]"
      style={{ top: position.top, left: position.left }}
    >
      {header}
      {body}
    </div>,
    document.body,
  );
}
