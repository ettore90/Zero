// Task / decision / log rows.
//
// These rows used to be emitted as HTML strings with the whole Tailwind class
// list baked in (`class="group relative flex w-full items-center gap-2 ..."`),
// which froze the presentation into the saved data: restyling the editor left
// every note written before the change rendering the old way. They now carry
// nothing but their semantics -- the data-note-* attributes the server's
// localized-edit code reads -- and all appearance comes from the .zero-note
// stylesheet.

import { clearPlaceholder, ensurePlaceholder, getSelection, placeCaret } from './blocks';

export type NoteRowType = 'task' | 'decision' | 'log';

export type NoteRowContext = {
  row: HTMLElement;
  type: NoteRowType;
  content: HTMLElement;
  leading: HTMLElement | null;
  trailing: HTMLElement | null;
  withinContent: boolean;
  withinLeading: boolean;
  withinTrailing: boolean;
  selection: Selection;
};

export function formatNoteDate(date = new Date()): string {
  return date.toLocaleDateString('en-GB');
}

export function newNoteRowId(type: NoteRowType): string {
  return `${type}-${Math.random().toString(36).slice(2, 10)}`;
}

function taskToggleLabel(completed: boolean): string {
  return `Mark task as ${completed ? 'incomplete' : 'completed'}`;
}

function createTaskToggle(completed: boolean): HTMLButtonElement {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.contentEditable = 'false';
  toggle.setAttribute('data-note-task-toggle', 'true');
  toggle.setAttribute('aria-pressed', String(completed));
  toggle.setAttribute('aria-label', taskToggleLabel(completed));
  return toggle;
}

/**
 * A row: leading affordance, the one editable span, optional trailing meta.
 * The check mark and the decision/log glyphs are drawn by CSS from
 * data-note-type / data-task-completed, so they stay out of the saved HTML and
 * out of every textContent measurement.
 */
export function createNoteRow(
  type: NoteRowType,
  options: { id?: string; completed?: boolean; meta?: string } = {},
): HTMLElement {
  const completed = options.completed ?? false;
  const row = document.createElement('p');
  row.setAttribute('data-note-type', type);
  row.setAttribute('data-note-id', options.id ?? newNoteRowId(type));
  if (type === 'task') row.setAttribute('data-task-completed', String(completed));

  const leading = document.createElement('span');
  leading.setAttribute('data-note-leading', 'true');
  leading.contentEditable = 'false';
  if (type === 'task') leading.appendChild(createTaskToggle(completed));
  else leading.setAttribute('aria-hidden', 'true');
  row.appendChild(leading);

  const content = document.createElement('span');
  content.setAttribute('data-note-content', 'true');
  content.appendChild(document.createElement('br'));
  row.appendChild(content);

  const meta = options.meta ?? (type === 'log' ? formatNoteDate() : '');
  if (meta) {
    const trailing = document.createElement('span');
    trailing.setAttribute('data-note-trailing-meta', 'true');
    trailing.contentEditable = 'false';
    const metaText = document.createElement('span');
    metaText.setAttribute('data-note-meta', 'true');
    metaText.textContent = meta;
    trailing.appendChild(metaText);
    row.appendChild(trailing);
  }

  return row;
}

/** An inline dated chip, for the `/date` command. */
export function createDateChip(date = new Date()): HTMLElement {
  const chip = document.createElement('span');
  chip.setAttribute('data-note-type', 'date');
  chip.setAttribute('data-note-id', `date-${Math.random().toString(36).slice(2, 10)}`);
  chip.setAttribute('data-note-meta', 'date');
  chip.textContent = formatNoteDate(date);
  return chip;
}

export function getNoteRowContext(root: HTMLElement): NoteRowContext | null {
  const selection = getSelection();
  const anchor = selection?.anchorNode;
  if (!selection || !anchor || !selection.isCollapsed || !root.contains(anchor)) return null;
  const anchorElement = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element | null);
  const row = anchorElement?.closest('p[data-note-type]') as HTMLElement | null;
  const type = row?.getAttribute('data-note-type') as NoteRowType | null;
  const content = row?.querySelector('[data-note-content]') as HTMLElement | null;
  if (!row || !type || !content) return null;
  const leading = row.querySelector('[data-note-leading]') as HTMLElement | null;
  const trailing = row.querySelector('[data-note-trailing-meta]') as HTMLElement | null;
  const holds = (region: HTMLElement | null) =>
    !!region && (region.contains(anchor) || region === anchorElement || region.contains(anchorElement ?? null));
  return {
    row,
    type,
    content,
    leading,
    trailing,
    withinContent: holds(content),
    withinLeading: holds(leading),
    withinTrailing: holds(trailing),
    selection,
  };
}

export function isNoteContentEmpty(content: HTMLElement): boolean {
  return (content.textContent ?? '').replace(/\u00a0/g, ' ').trim().length === 0;
}

export function updateTaskRowCompletion(row: HTMLElement, completed: boolean) {
  row.setAttribute('data-task-completed', String(completed));
  const toggle = row.querySelector('[data-note-task-toggle="true"]') as HTMLButtonElement | null;
  if (!toggle) return;
  toggle.setAttribute('aria-pressed', String(completed));
  toggle.setAttribute('aria-label', taskToggleLabel(completed));
}

/** Turn a row back into an ordinary paragraph, keeping the text the user wrote. */
export function unwrapNoteRow(row: HTMLElement): HTMLElement | null {
  const content = row.querySelector('[data-note-content]') as HTMLElement | null;
  if (!content) return null;
  const paragraph = document.createElement('p');
  clearPlaceholder(content);
  while (content.firstChild) paragraph.appendChild(content.firstChild);
  ensurePlaceholder(paragraph);
  row.replaceWith(paragraph);
  return paragraph;
}

/** Enter inside a row continues the same kind of row. */
export function continueNoteRow(row: HTMLElement, type: NoteRowType): HTMLElement {
  const next = createNoteRow(type, { id: newNoteRowId(type) });
  row.after(next);
  placeCaret(next, 'start');
  return next;
}

/**
 * Adopt rows saved by the previous editor. Their appearance was carried in
 * `class` attributes and their placeholder was a literal &nbsp;, and the glyphs
 * were inline SVG children; all three are dropped so old notes pick up the
 * current styling instead of rendering against classes this editor no longer
 * reasons about.
 */
export function migrateNoteRows(root: HTMLElement) {
  for (const element of Array.from(root.querySelectorAll('[data-note-type], [data-note-type] *')) as HTMLElement[]) {
    if (element.hasAttribute('class')) element.removeAttribute('class');
    if (element.hasAttribute('style')) element.removeAttribute('style');
  }

  for (const row of Array.from(root.querySelectorAll('p[data-note-type]')) as HTMLElement[]) {
    const type = row.getAttribute('data-note-type') as NoteRowType | null;
    if (!type) continue;

    const leading = row.querySelector('[data-note-leading]') as HTMLElement | null;
    if (leading) {
      leading.contentEditable = 'false';
      const toggle = leading.querySelector('[data-note-task-toggle="true"]') as HTMLElement | null;
      if (type === 'task') {
        // The check mark used to be the button's text, which made it show up in
        // every textContent measurement; CSS draws it now.
        if (toggle) toggle.textContent = '';
        else leading.replaceChildren(createTaskToggle(row.getAttribute('data-task-completed') === 'true'));
        leading.removeAttribute('aria-hidden');
      } else {
        leading.replaceChildren();
        leading.setAttribute('aria-hidden', 'true');
      }
    }

    const trailing = row.querySelector('[data-note-trailing-meta]') as HTMLElement | null;
    if (trailing) {
      trailing.contentEditable = 'false';
      if (!(trailing.textContent ?? '').trim()) trailing.remove();
    }

    const content = row.querySelector('[data-note-content]') as HTMLElement | null;
    if (content) {
      const onlyNbsp = (content.textContent ?? '').replace(/\u00a0/g, '').trim().length === 0;
      if (onlyNbsp) content.replaceChildren(document.createElement('br'));
    }

    if (type === 'task' && !row.hasAttribute('data-task-completed')) {
      row.setAttribute('data-task-completed', 'false');
    }
  }
}
