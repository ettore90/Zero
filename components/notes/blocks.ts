// The block model for the notes editor.
//
// The document *is* the DOM: the editor root holds nothing but block children,
// each one of p / h1-h3 / ul / ol / blockquote / pre / hr / table /
// p[data-note-type] / div[data-callout]. Everything in this file operates on
// Ranges, never on document.execCommand -- execCommand is kept only for the
// inline marks (bold/italic/underline), the one thing it does the same way in
// every browser. Enter, block splitting and block insertion used to go through
// it, and that is what made them nondeterministic: insertHTML of a <p> with the
// caret inside another <p> forces the browser to break the host block, and the
// nesting it leaves behind differs per engine.

/** Blocks that may sit directly under the editor root. */
export const TOP_BLOCK_SELECTOR = 'p, h1, h2, h3, ul, ol, blockquote, pre, hr, table, div[data-callout]';

/** Blocks that can host a caret. A list contributes its items, a table its cells. */
export const LEAF_BLOCK_SELECTOR = 'p, h1, h2, h3, li, blockquote, pre, td, th, div[data-callout]';

export type BlockTag = 'p' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'pre' | 'ul' | 'ol';

const VOID_BLOCK_TAGS = new Set(['HR', 'TABLE']);

// The legacy fontSize select emitted <font size="1..7">. styleWithCSS is on now,
// so nothing new arrives in that shape, but notes saved before it do.
const LEGACY_FONT_SIZES: Record<string, string> = {
  '1': '0.75rem',
  '2': '0.8125rem',
  '3': '0.9375rem',
  '4': '1.125rem',
  '5': '1.5rem',
  '6': '2rem',
  '7': '3rem',
};

export function getSelection(): Selection | null {
  if (typeof window === 'undefined') return null;
  return window.getSelection();
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** The caret's innermost caret-hosting block, or null when the caret is outside `root`. */
export function currentBlock(root: HTMLElement): HTMLElement | null {
  const selection = getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor || !root.contains(anchor)) return null;
  const block = elementOf(anchor)?.closest(LEAF_BLOCK_SELECTOR) as HTMLElement | null;
  return block && root.contains(block) ? block : null;
}

/** The top-level block the caret sits in -- the `ul` for an `li`, the `table` for a `td`. */
export function currentTopBlock(root: HTMLElement): HTMLElement | null {
  const selection = getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor || !root.contains(anchor)) return null;
  let candidate = elementOf(anchor)?.closest(TOP_BLOCK_SELECTOR) as HTMLElement | null;
  // A nested list resolves to the inner ul; walk out to the outermost one.
  while (candidate?.parentElement && candidate.parentElement !== root && root.contains(candidate.parentElement)) {
    const outer = candidate.parentElement.closest(TOP_BLOCK_SELECTOR) as HTMLElement | null;
    if (!outer || outer === candidate) break;
    candidate = outer;
  }
  return candidate && root.contains(candidate) ? candidate : null;
}

/**
 * True when a block holds no user content. A lone <br> is the placeholder an
 * empty block needs to stay focusable and keep its height, so it does not count
 * -- neither does &nbsp;, which is what the old note rows used as a placeholder
 * and is still sitting inside every note saved before this change.
 */
export function isEmptyBlock(block: HTMLElement | null): boolean {
  if (!block) return true;
  if (VOID_BLOCK_TAGS.has(block.tagName)) return false;
  if (block.querySelector('img, table, [data-note-task-toggle]')) return false;
  const text = (block.textContent ?? '').replace(/\u00a0/g, ' ').trim();
  return text.length === 0;
}

/** A fresh block, with the <br> placeholder an empty block needs to be focusable. */
export function createBlock(tag: BlockTag): HTMLElement {
  const element = document.createElement(tag);
  if (tag === 'ul' || tag === 'ol') {
    const item = document.createElement('li');
    item.appendChild(document.createElement('br'));
    element.appendChild(item);
    return element;
  }
  element.appendChild(document.createElement('br'));
  return element;
}

/** Swap a block's tag, keeping its children and its data-* attributes. */
export function renameBlock(block: HTMLElement, tag: BlockTag): HTMLElement {
  if (block.tagName.toLowerCase() === tag) return block;
  const replacement = document.createElement(tag);
  for (const attribute of Array.from(block.attributes)) {
    if (attribute.name.startsWith('data-')) replacement.setAttribute(attribute.name, attribute.value);
  }
  while (block.firstChild) replacement.appendChild(block.firstChild);
  ensurePlaceholder(replacement);
  block.replaceWith(replacement);
  return replacement;
}

export function ensurePlaceholder(block: HTMLElement) {
  if (VOID_BLOCK_TAGS.has(block.tagName)) return;
  // Range.extractContents leaves an empty text node behind when it splits one,
  // and a block whose only child is an empty text node has zero height --
  // Chrome then refuses to put the caret in it and silently drops the selection
  // back into the previous block, so the next keystroke landed in the half the
  // user had just split away from.
  for (const child of Array.from(block.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent === '') block.removeChild(child);
  }
  if (block.childNodes.length === 0) block.appendChild(document.createElement('br'));
}

/** Drop the <br> placeholder before writing real content into a block. */
export function clearPlaceholder(block: HTMLElement | null) {
  if (!block) return;
  if (block.childNodes.length === 1 && (block.firstChild as Element | null)?.nodeName === 'BR') {
    block.removeChild(block.firstChild!);
  }
}

/**
 * Where the caret goes when we drop it into a block: a note row hands it to its
 * content span (the leading glyph and the trailing meta are not for typing in),
 * a table to its first cell, a list to its first item.
 */
function caretHost(block: HTMLElement): HTMLElement {
  const noteContent = block.querySelector('[data-note-content]') as HTMLElement | null;
  if (noteContent) return noteContent;
  if (block.tagName === 'TABLE') {
    const cell = block.querySelector('td, th') as HTMLElement | null;
    if (cell) return cell;
  }
  if (block.tagName === 'UL' || block.tagName === 'OL') {
    const item = block.querySelector('li') as HTMLElement | null;
    if (item) return item;
  }
  return block;
}

export function placeCaret(block: HTMLElement, position: 'start' | 'end' = 'start') {
  const selection = getSelection();
  if (!selection) return;
  const host = caretHost(block);
  const range = document.createRange();
  const onlyChildIsBreak = host.childNodes.length === 1 && host.firstChild?.nodeName === 'BR';
  if (onlyChildIsBreak) {
    // collapse(false) past a lone <br> parks the caret on the line *after* it.
    range.setStart(host, 0);
    range.collapse(true);
  } else {
    range.selectNodeContents(host);
    range.collapse(position === 'start');
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Split the caret's block in two. Deterministic where execCommand's
 * insertParagraph was not: the tail is extracted as a fragment and re-parented,
 * so inline marks wrapping the caret split with it.
 *
 * `asTag` decides what the second half becomes -- a heading does not continue
 * into another heading.
 */
export function splitBlock(block: HTMLElement, asTag?: BlockTag): HTMLElement | null {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const caret = selection.getRangeAt(0);
  const tail = document.createRange();
  tail.setStart(caret.endContainer, caret.endOffset);
  tail.setEnd(block, block.childNodes.length);
  const fragment = tail.extractContents();

  const tag = asTag ?? (block.tagName.toLowerCase() as BlockTag);
  const next = document.createElement(tag);
  next.appendChild(fragment);
  block.after(next);

  ensurePlaceholder(block);
  ensurePlaceholder(next);
  placeCaret(next, 'start');
  return next;
}

/** Make sure the document ends in something typeable, so a trailing table or rule is escapable. */
export function ensureTrailingParagraph(root: HTMLElement) {
  const last = root.lastElementChild;
  if (!last || VOID_BLOCK_TAGS.has(last.tagName)) {
    root.appendChild(createBlock('p'));
  }
}

/**
 * Put a block into the document at the caret. This is the fix for the slash
 * commands: an empty host block is *replaced* rather than left behind as an
 * orphan paragraph, and a non-empty one is never cut open -- the new block goes
 * after it.
 */
export function insertBlock(root: HTMLElement, node: HTMLElement): HTMLElement {
  const leaf = currentBlock(root);
  const top = currentTopBlock(root);

  if (leaf && top && isEmptyBlock(leaf)) {
    if (leaf === top) {
      top.replaceWith(node);
    } else if (leaf.tagName === 'LI') {
      const list = leaf.parentElement;
      leaf.remove();
      if (list && !list.querySelector('li')) list.replaceWith(node);
      else (list ?? top).after(node);
    } else {
      top.after(node);
    }
  } else if (top) {
    top.after(node);
  } else {
    root.appendChild(node);
  }

  ensureTrailingParagraph(root);
  placeCaret(node, 'start');
  return node;
}

/**
 * Range.insertNode splits the text node it lands in, so the inserted node is
 * left with an empty text node on either side. Those offer no renderable
 * position, and Chrome answers a caret placed against one by sliding the
 * selection back into the previous text run -- which is how a line break ended
 * up with the next typed character in front of it instead of after it.
 */
function dropEmptyTextSiblings(node: Node) {
  for (const sibling of [node.previousSibling, node.nextSibling]) {
    if (sibling && sibling.nodeType === Node.TEXT_NODE && sibling.textContent === '') {
      sibling.parentNode?.removeChild(sibling);
    }
  }
}

/** Insert an inline node at the caret, replacing whatever the range covered. */
export function insertInline(root: HTMLElement, node: Node) {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return;
  clearPlaceholder(currentBlock(root));
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  dropEmptyTextSiblings(node);
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
}

/** Insert a line break at the caret -- Shift+Enter, which used to fall through to the browser. */
export function insertLineBreak(root: HTMLElement) {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const block = currentBlock(root);
  clearPlaceholder(block);
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  dropEmptyTextSiblings(br);
  // A break at the very end of a block needs a second one to be visible.
  if (!br.nextSibling) br.after(document.createElement('br'));
  const after = document.createRange();
  after.setStartAfter(br);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
}

/** Leave a list from an empty item, landing in a paragraph after it. */
export function exitList(item: HTMLElement): HTMLElement | null {
  const list = item.parentElement;
  if (!list) return null;
  const paragraph = createBlock('p');
  const trailing: Element[] = [];
  for (let sibling = item.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    trailing.push(sibling);
  }
  item.remove();
  list.after(paragraph);
  if (trailing.length) {
    const rest = document.createElement(list.tagName.toLowerCase());
    trailing.forEach((element) => rest.appendChild(element));
    paragraph.after(rest);
  }
  if (!list.querySelector('li')) list.remove();
  placeCaret(paragraph, 'start');
  return paragraph;
}

function convertLegacyFontTags(root: ParentNode) {
  for (const font of Array.from(root.querySelectorAll('font'))) {
    const span = document.createElement('span');
    const color = font.getAttribute('color');
    const face = font.getAttribute('face');
    const size = font.getAttribute('size');
    if (color) span.style.color = color;
    if (face) span.style.fontFamily = face;
    if (size && LEGACY_FONT_SIZES[size]) span.style.fontSize = LEGACY_FONT_SIZES[size];
    while (font.firstChild) span.appendChild(font.firstChild);
    if (span.getAttribute('style')) font.replaceWith(span);
    else font.replaceWith(...Array.from(span.childNodes));
  }
}

let blockIdCounter = 0;

/**
 * Blocks carry a data-block-id so the server's localized note edits
 * (services/sessionNoteService.js, PATCH .../notes/:noteId with create_block /
 * replace_block / remove_block) can address a hand-written note. Before this,
 * agents could only address notes they had authored themselves.
 */
export function assignBlockIds(root: HTMLElement) {
  for (const block of Array.from(root.children) as HTMLElement[]) {
    if (VOID_BLOCK_TAGS.has(block.tagName) && block.tagName === 'HR') continue;
    if (!block.getAttribute('data-block-id')) {
      blockIdCounter += 1;
      block.setAttribute('data-block-id', `b${Date.now().toString(36)}${blockIdCounter.toString(36)}`);
    }
  }
}

/**
 * Bring the root back to the block invariant. Runs on hydration and after paste
 * -- not on the typing path, where the operations above already keep it true.
 *
 * The editor used to ship a deliberately empty sanitizer, because an earlier
 * version rewrote <div><br></div> into an inline <br /> and so changed a block
 * into an inline break on every line feed, which then fought the controlled
 * value back into the DOM and took the caret with it. Renaming a div to a p
 * keeps it a block, and now that Enter is ours the browser stops producing divs
 * on the normal path anyway.
 */
export function normalizeBlocks(root: HTMLElement) {
  convertLegacyFontTags(root);

  // Unwrap or rename stray divs, innermost first, until the top level is clean.
  for (let pass = 0; pass < 4; pass += 1) {
    const strays = Array.from(root.querySelectorAll('div:not([data-callout])')) as HTMLElement[];
    if (!strays.length) break;
    for (const stray of strays.reverse()) {
      if (stray.querySelector(TOP_BLOCK_SELECTOR)) stray.replaceWith(...Array.from(stray.childNodes));
      else renameBlock(stray, 'p');
    }
  }

  // Wrap runs of loose inline content into paragraphs, in place. Appending them
  // to the end instead would silently reorder the document.
  let child: Node | null = root.firstChild;
  while (child) {
    const isTopBlock = child.nodeType === Node.ELEMENT_NODE && (child as Element).matches(TOP_BLOCK_SELECTOR);
    if (isTopBlock) {
      child = child.nextSibling;
      continue;
    }
    if (child.nodeType === Node.TEXT_NODE && !(child.textContent ?? '').trim()) {
      const blank = child;
      child = child.nextSibling;
      root.removeChild(blank);
      continue;
    }
    const paragraph = document.createElement('p');
    root.insertBefore(paragraph, child);
    let run: Node | null = child;
    while (run) {
      const next: Node | null = run.nextSibling;
      const runIsTopBlock = run.nodeType === Node.ELEMENT_NODE && (run as Element).matches(TOP_BLOCK_SELECTOR);
      if (runIsTopBlock) break;
      paragraph.appendChild(run);
      run = next;
    }
    ensurePlaceholder(paragraph);
    child = paragraph.nextSibling;
  }

  for (const block of Array.from(root.querySelectorAll(LEAF_BLOCK_SELECTOR)) as HTMLElement[]) {
    ensurePlaceholder(block);
  }
  ensureTrailingParagraph(root);
  if (!root.firstElementChild) root.appendChild(createBlock('p'));
  assignBlockIds(root);
}

// --- Caret offsets -----------------------------------------------------------
// Offsets survive an innerHTML rebuild; a Range does not, because every node it
// points at is destroyed. Only the controlled-value sync needs this.

export function getCaretOffset(root: HTMLElement): number | null {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const probe = range.cloneRange();
  probe.selectNodeContents(root);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length;
}

export function setCaretOffset(root: HTMLElement, offset: number) {
  const selection = getSelection();
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
  // Past the end, or nothing but <br> placeholders to land in. Park the caret
  // inside the last block rather than at the root, where no block operation
  // would be able to find it.
  const blocks = root.querySelectorAll(LEAF_BLOCK_SELECTOR);
  const last = blocks[blocks.length - 1] as HTMLElement | undefined;
  if (last) {
    placeCaret(last, 'end');
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The caret's text offset inside a given element. */
export function getOffsetWithin(container: HTMLElement, selection: Selection): number {
  if (!selection.rangeCount) return 0;
  const range = selection.getRangeAt(0);
  const probe = range.cloneRange();
  probe.selectNodeContents(container);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().replace(/\u00a0/g, ' ').length;
}

/**
 * The text from the start of `host` to the caret, with every <br> rendered as a
 * newline. Range.toString() erases breaks, which is why the "/" trigger did not
 * fire on a line that had been started with Shift+Enter: the slash looked as
 * though it followed the previous line's last character.
 */
export function textBeforeCaret(host: HTMLElement): string | null {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.startContainer) && host !== range.startContainer) return null;
  const probe = document.createRange();
  probe.selectNodeContents(host);
  probe.setEnd(range.startContainer, range.startOffset);
  const fragment = probe.cloneContents();
  for (const br of Array.from(fragment.querySelectorAll('br'))) {
    br.replaceWith(document.createTextNode('\n'));
  }
  return (fragment.textContent ?? '').replace(/\u00a0/g, ' ');
}

/** The mirror of textBeforeCaret: everything from the caret to the block's end. */
export function textAfterCaret(host: HTMLElement): string | null {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.endContainer) && host !== range.endContainer) return null;
  const probe = document.createRange();
  probe.selectNodeContents(host);
  probe.setStart(range.endContainer, range.endOffset);
  const fragment = probe.cloneContents();
  for (const br of Array.from(fragment.querySelectorAll('br'))) {
    br.replaceWith(document.createTextNode('\n'));
  }
  return (fragment.textContent ?? '').replace(/\u00a0/g, ' ');
}

/** Strip the trailing <br> run an "empty last line" leaves behind. */
export function trimTrailingBreaks(block: HTMLElement) {
  while (block.lastChild?.nodeName === 'BR') block.removeChild(block.lastChild);
}

/** The <pre> equivalent: its line breaks are real newline characters. */
export function trimTrailingNewlines(block: HTMLElement) {
  let last = block.lastChild;
  while (last && last.nodeType === Node.TEXT_NODE) {
    const trimmed = (last.textContent ?? '').replace(/\n+$/, '');
    if (trimmed === last.textContent) break;
    if (trimmed) {
      last.textContent = trimmed;
      break;
    }
    block.removeChild(last);
    last = block.lastChild;
  }
}

/**
 * Enter inside a <pre>. A newline at the very end of the block has no line to
 * render, so a second one is written and the caret parked between them -- the
 * same trick insertLineBreak uses for a trailing <br>.
 */
export function insertNewlineInPre(root: HTMLElement) {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const block = currentBlock(root);
  clearPlaceholder(block);
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode('\n');
  range.insertNode(node);
  dropEmptyTextSiblings(node);
  if (!node.nextSibling) node.textContent = '\n\n';
  const after = document.createRange();
  after.setStart(node, 1);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
}

/** Map a pair of text offsets inside `host` back onto a live Range. */
export function rangeForOffsets(host: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!startNode && start <= consumed + length) {
      startNode = node;
      startOffset = start - consumed;
    }
    if (startNode && end <= consumed + length) {
      endNode = node;
      endOffset = end - consumed;
      break;
    }
    consumed += length;
    node = walker.nextNode();
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

/** Insert literal text at the caret -- Enter inside a <pre>. */
export function insertText(root: HTMLElement, text: string) {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return;
  clearPlaceholder(currentBlock(root));
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  dropEmptyTextSiblings(node);
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
}

export function unwrapList(list: HTMLElement): HTMLElement[] {
  const paragraphs: HTMLElement[] = [];
  for (const item of Array.from(list.children)) {
    const paragraph = document.createElement('p');
    while (item.firstChild) paragraph.appendChild(item.firstChild);
    ensurePlaceholder(paragraph);
    paragraphs.push(paragraph);
  }
  if (!paragraphs.length) paragraphs.push(createBlock('p'));
  list.replaceWith(...paragraphs);
  return paragraphs;
}

export function renameList(list: HTMLElement, kind: 'ul' | 'ol'): HTMLElement {
  if (list.tagName.toLowerCase() === kind) return list;
  const replacement = document.createElement(kind);
  while (list.firstChild) replacement.appendChild(list.firstChild);
  list.replaceWith(replacement);
  return replacement;
}

export function wrapBlockAsListItem(block: HTMLElement, kind: 'ul' | 'ol'): HTMLElement {
  const list = document.createElement(kind);
  const item = document.createElement('li');
  while (block.firstChild) item.appendChild(block.firstChild);
  ensurePlaceholder(item);
  list.appendChild(item);
  block.replaceWith(list);
  return item;
}

/**
 * Apply an inline style to the selection, or to the whole block when the caret
 * is collapsed. This replaces execCommand('fontName'|'fontSize'|'foreColor'),
 * which emitted deprecated <font size="3"> tags that neither the paste
 * sanitizer nor the server's HTML surgery understands.
 */
export function styleSelection(root: HTMLElement, property: 'fontFamily' | 'fontSize' | 'color' | 'backgroundColor', value: string) {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);

  if (range.collapsed) {
    const block = currentBlock(root);
    if (!block) return;
    const target = (block.querySelector('[data-note-content]') as HTMLElement | null) ?? block;
    target.style[property] = value;
    return;
  }

  const span = document.createElement('span');
  span.style[property] = value;
  span.appendChild(range.extractContents());
  range.insertNode(span);
  const next = document.createRange();
  next.selectNodeContents(span);
  selection.removeAllRanges();
  selection.addRange(next);
}
