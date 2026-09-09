/**
 * On-device input-latency probe.
 *
 * Why this exists: typing in the chat lags on a tablet with an external
 * keyboard, and that does not reproduce on the Linux WebKit/Chromium builds
 * available here -- measured from this machine the chat input already sits at
 * the engine's floor. So the measurement has to happen on the device that
 * actually shows the symptom.
 *
 * Inert unless the URL carries `?perfprobe=1`, so it costs nothing in normal
 * use. Open the app on the device with that parameter, type a couple of
 * sentences, and read the overlay.
 *
 * Metric: time from `keydown` to the second animation frame after it, i.e.
 * roughly "when did the character actually get painted". Reported as a median
 * and p90 over the most recent samples, which is far more stable than
 * averaging frame deltas.
 *
 * Variants, to bisect a cause on the real device -- add any of them to the URL
 * alongside `perfprobe=1`:
 *
 *   &noanim=1        kill every running CSS animation
 *   &notransition=1  kill every CSS transition
 *   &noshadow=1      drop every box-shadow
 *   &onepanel=1      hide all but the first mounted chat message list
 *   &nomsgs=1        hide every chat message list
 *   &cv=1            content-visibility:auto on message rows
 *
 * Run the same typing burst with and without one variant and compare medians.
 *
 * The overlay only repaints once typing has paused, so it cannot contaminate
 * the numbers it reports.
 */

import { NEBULA_API_BASE } from '../constants';

const SAMPLE_CAP = 120;
const IDLE_REDRAW_MS = 400;

const VARIANT_KEYS = ['noanim', 'notransition', 'noshadow', 'onepanel', 'nomsgs', 'cv'] as const;
type VariantKey = (typeof VARIANT_KEYS)[number];

const MSG_LIST_SELECTOR = 'div.custom-scrollbar.space-y-5';

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

function buildStyleSheet(active: Set<VariantKey>) {
  const rules: string[] = [];
  if (active.has('noanim')) rules.push('*,*::before,*::after{animation:none!important}');
  if (active.has('notransition')) rules.push('*,*::before,*::after{transition:none!important}');
  if (active.has('noshadow')) rules.push('*{box-shadow:none!important}');
  return rules.join('\n');
}

/** Variants that CSS alone cannot express; re-applied whenever the overlay redraws. */
function applyDomVariants(active: Set<VariantKey>) {
  const lists = Array.from(document.querySelectorAll<HTMLElement>(MSG_LIST_SELECTOR));
  lists.forEach((list, index) => {
    const hide = active.has('nomsgs') || (active.has('onepanel') && index > 0);
    list.style.display = hide ? 'none' : '';
    if (active.has('cv')) {
      for (const row of Array.from(list.children) as HTMLElement[]) {
        row.style.contentVisibility = 'auto';
        row.style.containIntrinsicSize = 'auto 400px';
      }
    }
  });
}

export function installPerfProbe() {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  if (params.get('perfprobe') !== '1') return;

  const active = new Set<VariantKey>(VARIANT_KEYS.filter((key) => params.get(key) === '1'));

  if (active.size > 0) {
    const sheet = document.createElement('style');
    sheet.id = 'perf-probe-css';
    sheet.textContent = buildStyleSheet(active);
    document.head.appendChild(sheet);
  }

  const samples: number[] = [];
  let lastTarget = '-';

  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:2147483647',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'background:rgba(15,23,42,0.94)', 'color:#e2e8f0',
    'padding:8px 10px', 'border-radius:8px', 'border:1px solid rgba(148,163,184,0.35)',
    'max-width:60vw', 'white-space:pre', 'user-select:text',
  ].join(';');

  const readout = document.createElement('div');
  const buttons = document.createElement('div');
  buttons.style.cssText = 'margin-top:6px;display:flex;gap:6px';

  const mkButton = (label: string, onTap: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:11px ui-monospace,monospace;padding:4px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.4);background:rgba(51,65,85,0.9);color:#e2e8f0';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onTap(); });
    buttons.appendChild(b);
    return b;
  };

  const summary = () => {
    const sorted = [...samples].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const p90 = percentile(sorted, 0.9);
    const variants = active.size ? Array.from(active).join(',') : 'none';
    return [
      `PERF PROBE   n=${samples.length}`,
      `median ${median.toFixed(0)}ms   p90 ${p90.toFixed(0)}ms`,
      `anims ${document.getAnimations().length}   nodes ${document.querySelectorAll('*').length}`,
      `msgLists ${document.querySelectorAll(MSG_LIST_SELECTOR).length}   field ${lastTarget}`,
      `variants ${variants}`,
    ].join('\n');
  };

  mkButton('reset', () => { samples.length = 0; redraw(); });
  mkButton('copy', () => {
    const text = summary();
    navigator.clipboard?.writeText(text).catch(() => {});
  });

  panel.appendChild(readout);
  panel.appendChild(buttons);

  // Posted to the backend as well as shown, so the numbers can be read from
  // the machine running the app instead of transcribed off a tablet screen.
  // Fire-and-forget: a failure here must never disturb the page being measured.
  const report = () => {
    if (samples.length < 5) return;
    const sorted = [...samples].sort((a, b) => a - b);
    const body = {
      label: 'chat-input',
      variants: active.size ? Array.from(active).join(',') : 'none',
      samples: samples.length,
      median: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      max: sorted[sorted.length - 1],
      animations: document.getAnimations().length,
      domNodes: document.querySelectorAll('*').length,
      msgLists: document.querySelectorAll(MSG_LIST_SELECTOR).length,
      field: lastTarget,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    };
    fetch(`${NEBULA_API_BASE}/perf-probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  };

  let redrawTimer: number | null = null;
  const redraw = () => {
    redrawTimer = null;
    applyDomVariants(active);
    readout.textContent = summary();
    report();
  };
  // Debounced: nothing here repaints while a typing burst is in flight, so the
  // overlay cannot inflate the latency it is measuring.
  const scheduleRedraw = () => {
    if (redrawTimer !== null) window.clearTimeout(redrawTimer);
    redrawTimer = window.setTimeout(redraw, IDLE_REDRAW_MS);
  };

  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const isText =
        target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;
      if (!isText) return;
      lastTarget = target.isContentEditable ? 'contentEditable' : target.tagName.toLowerCase();
      const started = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          samples.push(performance.now() - started);
          if (samples.length > SAMPLE_CAP) samples.shift();
          scheduleRedraw();
        })
      );
    },
    true
  );

  const mount = () => {
    document.body.appendChild(panel);
    redraw();
  };
  if (document.body) mount();
  else window.addEventListener('DOMContentLoaded', mount, { once: true });
}
