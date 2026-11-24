/// <reference lib="dom" />
/**
 * A synthetic stand-in for an Angular order list, the page whose second opening stopped the
 * instant replay of VIS-19: re-rendering its table adds, in one mutation batch, about 3,000 anchor
 * comments, 2,600 spans, 1,600 texts, 1,400 divs, 2,000 cells and 200 rows, and the page carries
 * about 1.67 MB of inline CSS. Built from those counts alone, it holds no real markup or data.
 */

/** What one re-render of the table adds, by kind, and the CSS the page carries. */
export const ORDER_LIST_SHAPE = Object.freeze({
  rows: 200,
  cellsPerRow: 10,
  /** Angular anchor comments: one per cell and five per row. */
  commentsPerRow: 15,
  spansPerRow: 13,
  textsPerRow: 8,
  divsPerRow: 7,
  cssBytes: 1_670_000,
});

export interface OrderList {
  readonly root: HTMLElement;
  /** Replaces every row in one synchronous change, as a re-render on opening the list does. */
  render(seed: number): void;
  remove(): void;
}

export interface OrderListOptions {
  /** How many bytes of CSS the page carries; `ORDER_LIST_SHAPE.cssBytes` unless given. */
  cssBytes?: number;
}

/** Synthetic CSS rules, about `bytes` characters of them. */
export function fixtureCss(bytes: number): string {
  let text = '';
  for (let index = 0; text.length < bytes; index += 1) {
    text +=
      `.ol-c${String(index)} .ol-v${String(index % 97)}{color:#${(index * 2_654_435).toString(16).slice(-6).padStart(6, '0')};` +
      `margin:${String(index % 13)}px ${String(index % 7)}px;padding:${String(index % 5)}px}\n`;
  }
  return text;
}

function row(doc: Document, seed: number, index: number): HTMLTableRowElement {
  const shape = ORDER_LIST_SHAPE;
  const tr = doc.createElement('tr');
  tr.className = 'ol-row';
  let comments = 0;
  let texts = 0;
  let divs = 0;
  for (let cell = 0; cell < shape.cellsPerRow; cell += 1) {
    const td = doc.createElement('td');
    td.className = `ol-c${String(cell)}`;
    td.append(doc.createComment(''));
    comments += 1;
    const holder = divs < shape.divsPerRow ? doc.createElement('div') : td;
    if (holder !== td) {
      divs += 1;
      td.append(holder);
    }
    const perCell = cell < shape.spansPerRow - shape.cellsPerRow ? 2 : 1;
    for (let part = 0; part < perCell; part += 1) {
      const span = doc.createElement('span');
      span.className = `ol-v${String((seed + cell + part) % 97)}`;
      if (texts < shape.textsPerRow) {
        span.textContent = `${String(seed)}-${String(index)}-${String(cell)}-${String(part)}`;
        texts += 1;
      }
      holder.append(span);
    }
    tr.append(td);
  }
  while (comments < shape.commentsPerRow) {
    tr.append(doc.createComment(''));
    comments += 1;
  }
  return tr;
}

/** Mounts the list in `doc` with its first rows rendered. */
export function mountOrderList(doc: Document, options: OrderListOptions = {}): OrderList {
  const root = doc.createElement('main');
  const style = doc.createElement('style');
  style.textContent = fixtureCss(options.cssBytes ?? ORDER_LIST_SHAPE.cssBytes);
  const table = doc.createElement('table');
  const body = doc.createElement('tbody');
  table.append(body);
  root.append(style, table);
  doc.body.append(root);
  function render(seed: number): void {
    const fragment = doc.createDocumentFragment();
    for (let index = 0; index < ORDER_LIST_SHAPE.rows; index += 1) {
      fragment.append(row(doc, seed, index));
    }
    body.replaceChildren(fragment);
  }
  render(0);
  return {
    root,
    render,
    remove() {
      root.remove();
    },
  };
}
