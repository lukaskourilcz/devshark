// Imported with PostHog only after analytics consent. A detached interaction
// target can make web-vitals fall back to a raw selector even with generateTarget.
import { onCLS, onINP, onLCP } from 'web-vitals/attribution';

const TARGET_TAGS = new Set([
  'a', 'article', 'aside', 'button', 'canvas', 'code', 'div', 'fieldset', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'img', 'input', 'label',
  'li', 'main', 'nav', 'p', 'pre', 'section', 'select', 'span', 'svg', 'textarea', 'video',
]);

const safeTarget = (value: unknown): string =>
  typeof value === 'string' && TARGET_TAGS.has(value) ? value : 'unknown';

const targetOptions = { generateTarget: (node: Node | null) => safeTarget(node instanceof Element ? node.localName : null) };
type Vital = 'web_vital_lcp' | 'web_vital_inp' | 'web_vital_cls';
export const isWebVital = (event: unknown): event is Vital =>
  event === 'web_vital_lcp' || event === 'web_vital_inp' || event === 'web_vital_cls';

let observing = false;

/** web-vitals keeps one observer set for the lifecycle of a document. Its
 * buffered entries can predate an in-page opt-in or a later re-consent. */
export function startWebVitals(
  sinceConsent: () => number,
  capture: (name: Vital, properties: { value: number; target: string }) => void,
): void {
  if (observing || typeof PerformanceObserver === 'undefined') return;
  observing = true;
  const report = (name: Vital, metric: { value: number; entries: PerformanceEntry[] }, target: string | undefined) => {
    const since = sinceConsent();
    if (!Number.isFinite(since) || !Number.isFinite(metric.value) || metric.value < 0) return;
    if (since > 0 && (!metric.entries.length || metric.entries.some(entry => entry.startTime < since))) return;
    capture(name, { value: metric.value, target: safeTarget(target) });
  };
  onLCP(metric => report('web_vital_lcp', metric, metric.attribution.target), targetOptions);
  onINP(metric => report('web_vital_inp', metric, metric.attribution.interactionTarget), targetOptions);
  onCLS(metric => report('web_vital_cls', metric, metric.attribution.largestShiftTarget), targetOptions);
}

/** The SDK has already added device, campaign, URL, profile and session data
 * at before_send. Keep only the two measurement fields and the two transport
 * properties PostHog needs to route and attribute an ordinary capture. */
export function vitalEventProperties(properties: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...(typeof properties.token === 'string' ? { token: properties.token } : {}),
    ...(typeof properties.distinct_id === 'string' ? { distinct_id: properties.distinct_id } : {}),
    ...(typeof properties.value === 'number' && Number.isFinite(properties.value) ? { value: properties.value } : {}),
    target: safeTarget(properties.target),
  };
}
