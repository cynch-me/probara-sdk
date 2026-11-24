/// <reference lib="dom" />
/**
 * A synthetic stand-in for an Angular asset list, the page whose opening VIS-20 lost to a pause:
 * a 100-row table of 3,500 cells, 700 of them editable, about 35,000 nodes, and a 1.3 MB
 * stylesheet that a `<link>` loads and rrweb inlines into every full snapshot. Built from those
 * counts alone, it holds no real markup or data.
 */
import { fixtureCss } from './order-list.js';

export const ASSET_LIST_SHAPE = Object.freeze({
  rows: 100,
  cellsPerRow: 35,
  /** Every fifth cell holds an input. */
  editableEvery: 5,
  cssBytes: 1_300_000,
});

export interface AssetList {
  readonly root: HTMLElement;
  remove(): void;
}

export interface AssetListOptions {
  /** How many bytes of CSS the stylesheet holds; `ASSET_LIST_SHAPE.cssBytes` unless given. */
  cssBytes?: number;
}

function text(doc: Document, tag: string, className: string, content: string): HTMLElement {
  const element = doc.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

function cell(doc: Document, row: number, column: number): HTMLTableCellElement {
  const td = doc.createElement('td');
  td.className = `ol-c${String(column)}`;
  const holder = doc.createElement('div');
  holder.className = 'al-cell';
  holder.append(text(doc, 'span', 'al-label', `field ${String(column)}`));
  if (column % ASSET_LIST_SHAPE.editableEvery === 0) {
    const input = doc.createElement('input');
    input.value = `asset-${String(row)}-${String(column)}`;
    holder.append(input, text(doc, 'span', 'al-hint', 'editable'));
  } else {
    holder.append(text(doc, 'span', 'al-value', `${String(row)}.${String(column)}`));
  }
  const meta = text(doc, 'div', 'al-meta', 'meta');
  meta.append(text(doc, 'span', 'al-tag', `t${String(column % 7)}`));
  holder.append(meta);
  td.append(holder);
  return td;
}

/**
 * Opens the list in `doc` in one change, as a navigation to it does, once its stylesheet has
 * loaded.
 */
export async function mountAssetList(
  doc: Document,
  options: AssetListOptions = {},
): Promise<AssetList> {
  const href = URL.createObjectURL(
    new Blob([fixtureCss(options.cssBytes ?? ASSET_LIST_SHAPE.cssBytes)], { type: 'text/css' }),
  );
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  await new Promise<void>((resolve, reject) => {
    link.onload = () => {
      resolve();
    };
    link.onerror = () => {
      reject(new Error('the asset list stylesheet did not load'));
    };
    doc.head.append(link);
  });
  const root = doc.createElement('main');
  const table = doc.createElement('table');
  const body = doc.createElement('tbody');
  for (let row = 0; row < ASSET_LIST_SHAPE.rows; row += 1) {
    const tr = doc.createElement('tr');
    for (let column = 0; column < ASSET_LIST_SHAPE.cellsPerRow; column += 1) {
      tr.append(cell(doc, row, column));
    }
    body.append(tr);
  }
  table.append(body);
  root.append(table);
  doc.body.append(root);
  return {
    root,
    remove() {
      root.remove();
      link.remove();
      URL.revokeObjectURL(href);
    },
  };
}
