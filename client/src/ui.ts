/** Tiny DOM helpers: no framework needed for a handful of screens. */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;

export function h(tag: string, attrs: Attrs = {}, ...children: Child[] | Child[][]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' && typeof v === 'string') el.setAttribute('style', v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function showScreen(content: HTMLElement | null) {
  const s = $('screen');
  s.replaceChildren();
  if (content) {
    s.append(content);
    s.hidden = false;
    s.scrollTop = 0;
  } else s.hidden = true;
}

/** Shows a modal and resolves when it is closed via the returned `close`. */
export function showModal(build: (close: (v?: unknown) => void) => HTMLElement): Promise<unknown> {
  const m = $('modal');
  return new Promise((resolve) => {
    const close = (v?: unknown) => {
      m.hidden = true;
      m.replaceChildren();
      resolve(v);
    };
    m.replaceChildren(build(close));
    m.hidden = false;
  });
}

let toastTimer: number | undefined;
export function toast(msg: string, kind: 'info' | 'error' = 'info', ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

export function starsHtml(n: number, total = 3) {
  return h('span', {}, ...Array.from({ length: total }, (_, i) => h('span', { class: i < n ? '' : 'off' }, '★')));
}

export const rarityCss = (r: string) => `var(--${r})`;
