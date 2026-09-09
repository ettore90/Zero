/**
 * In-process ring buffer for the on-device input-latency probe.
 *
 * The probe (utils/perfProbe.ts) runs in the browser on the device that shows
 * the lag -- a tablet -- and its samples live only in that page's memory,
 * where nobody else can read them. This lets the probe post its summary so the
 * numbers can be read back from the machine running the app, instead of being
 * transcribed by hand.
 *
 * Deliberately not persisted: these are throwaway diagnostics, and a restart
 * clearing them is the right behaviour.
 */

const MAX_REPORTS = 60;
const reports = [];

export function addReport(report) {
  reports.push(report);
  while (reports.length > MAX_REPORTS) reports.shift();
  return reports.length;
}

export function listReports() {
  return reports.slice();
}

export function clearReports() {
  const removed = reports.length;
  reports.length = 0;
  return removed;
}

/**
 * Keeps only the fields the probe is expected to send, bounded in size, so an
 * unauthenticated caller on the LAN cannot use this as arbitrary storage.
 */
export function sanitizeReport(body, meta = {}) {
  const num = (value) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(1)) : null);
  const str = (value, max) =>
    value === undefined || value === null ? null : String(value).slice(0, max);

  return {
    receivedAt: new Date().toISOString(),
    label: str(body?.label, 60),
    variants: str(body?.variants, 120),
    samples: num(body?.samples),
    median: num(body?.median),
    p90: num(body?.p90),
    max: num(body?.max),
    animations: num(body?.animations),
    domNodes: num(body?.domNodes),
    msgLists: num(body?.msgLists),
    field: str(body?.field, 30),
    viewport: str(body?.viewport, 30),
    userAgent: str(meta.userAgent, 200),
  };
}
