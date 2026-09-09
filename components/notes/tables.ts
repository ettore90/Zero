// Table editing. The logic is the one the editor already had -- only the shape
// it works on changed: cells hold a <br> placeholder instead of a literal
// &nbsp;, and a new table is built as a node for insertBlock rather than an
// HTML string handed to execCommand('insertHTML').

import { getSelection } from './blocks';

export type TableCellInfo = {
  table: HTMLTableElement;
  tbody: HTMLTableSectionElement;
  row: HTMLTableRowElement;
  cell: HTMLTableCellElement;
  rowIndex: number;
  cellIndex: number;
};

/**
 * Only rectangular single-tbody tables are editable here. Anything with a
 * thead, a caption, spans or a nested table is left alone rather than mangled.
 */
export function isSupportedTable(table: HTMLTableElement | null | undefined): table is HTMLTableElement {
  if (!table) return false;
  if (table.querySelector('thead, tfoot, colgroup, caption, table')) return false;
  const children = Array.from(table.children);
  if (children.length !== 1 || children[0].tagName !== 'TBODY') return false;
  const tbody = children[0] as HTMLTableSectionElement;
  const rows = Array.from(tbody.rows);
  if (rows.length === 0) return false;
  const width = rows[0].cells.length;
  if (width === 0) return false;
  return rows.every((row) =>
    row.tagName === 'TR' &&
    row.cells.length === width &&
    Array.from(row.cells as HTMLCollectionOf<HTMLTableCellElement>).every(
      (cell) =>
        (cell.tagName === 'TD' || cell.tagName === 'TH') &&
        cell.rowSpan === 1 &&
        cell.colSpan === 1 &&
        !cell.querySelector('table'),
    ),
  );
}

export function createEmptyTableCell(tagName: 'TD' | 'TH' = 'TD'): HTMLTableCellElement {
  const cell = document.createElement(tagName.toLowerCase()) as HTMLTableCellElement;
  cell.appendChild(document.createElement('br'));
  cell.rowSpan = 1;
  cell.colSpan = 1;
  return cell;
}

export function createTable(rows: number, columns: number): HTMLTableElement {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  for (let r = 0; r < Math.max(1, rows); r += 1) {
    const row = document.createElement('tr');
    for (let c = 0; c < Math.max(1, columns); c += 1) {
      row.appendChild(createEmptyTableCell(r === 0 ? 'TH' : 'TD'));
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

export function setSelectionInsideCell(cell: HTMLTableCellElement) {
  const selection = getSelection();
  if (!selection) return;
  const range = document.createRange();
  const onlyChildIsBreak = cell.childNodes.length === 1 && cell.firstChild?.nodeName === 'BR';
  if (onlyChildIsBreak) range.setStart(cell, 0);
  else range.selectNodeContents(cell);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function getTableCellInfo(root: HTMLElement): TableCellInfo | null {
  const selection = getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor || !root.contains(anchor)) return null;
  const element = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
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

/** Each mutation returns true when the table is gone and the caller must re-home the caret. */
export function addTableRow(info: TableCellInfo, direction: 'before' | 'after'): boolean {
  const { tbody, row } = info;
  const cells = Array.from(row.cells).map((current) => createEmptyTableCell(current.tagName === 'TH' ? 'TH' : 'TD'));
  if (!cells.length) return false;
  const newRow = document.createElement('tr');
  cells.forEach((cell) => newRow.appendChild(cell));
  if (direction === 'before') tbody.insertBefore(newRow, row);
  else tbody.insertBefore(newRow, row.nextElementSibling);
  const target = newRow.cells[Math.min(info.cellIndex, newRow.cells.length - 1)] as HTMLTableCellElement | undefined;
  if (target) setSelectionInsideCell(target);
  return false;
}

export function removeTableRow(info: TableCellInfo): boolean {
  const { tbody, row, table } = info;
  if (tbody.rows.length <= 1) {
    table.remove();
    return true;
  }
  const next = row.nextElementSibling as HTMLTableRowElement | null;
  const previous = row.previousElementSibling as HTMLTableRowElement | null;
  row.remove();
  const fallback = next ?? previous ?? tbody.rows[0] ?? null;
  const target = fallback?.cells[Math.min(info.cellIndex, fallback.cells.length - 1)] as HTMLTableCellElement | undefined;
  if (target) setSelectionInsideCell(target);
  return !target;
}

export function addTableColumn(info: TableCellInfo, direction: 'before' | 'after'): boolean {
  for (const row of Array.from(info.tbody.rows)) {
    const reference = row.cells[info.cellIndex] ?? null;
    const cell = createEmptyTableCell(reference?.tagName === 'TH' ? 'TH' : 'TD');
    if (reference && direction === 'before') row.insertBefore(cell, reference);
    else row.insertBefore(cell, reference ? reference.nextElementSibling : null);
  }
  const row = info.tbody.rows[info.rowIndex];
  const target = row?.cells[direction === 'before' ? info.cellIndex : info.cellIndex + 1] as HTMLTableCellElement | undefined;
  if (target) setSelectionInsideCell(target);
  return false;
}

export function removeTableColumn(info: TableCellInfo): boolean {
  const rows = Array.from(info.tbody.rows);
  if ((rows[0]?.cells.length ?? 0) <= 1) {
    info.table.remove();
    return true;
  }
  rows.forEach((row) => row.cells[info.cellIndex]?.remove());
  const row = info.tbody.rows[Math.min(info.rowIndex, info.tbody.rows.length - 1)];
  const target = row?.cells[Math.min(info.cellIndex, Math.max(0, row.cells.length - 1))] as HTMLTableCellElement | undefined;
  if (target) setSelectionInsideCell(target);
  return !target;
}

export function removeTable(info: TableCellInfo): boolean {
  info.table.remove();
  return true;
}
