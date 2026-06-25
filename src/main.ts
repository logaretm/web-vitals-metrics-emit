import * as Sentry from '@sentry/browser';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import type { CLSMetric, FCPMetric, INPMetric, LCPMetric, TTFBMetric } from 'web-vitals';

// ---------------------------------------------------------------------------
// Capture: wrap the real transport so envelopes still go to the DSN, but we
// also pull out every `trace_metric` item and render its exact serialized
// shape (this is what Relay / the backend actually receives).
// ---------------------------------------------------------------------------
const capturedMetrics: unknown[] = [];

function renderCaptured(): void {
  const out = document.getElementById('out')!;
  out.textContent = capturedMetrics.length
    ? JSON.stringify(capturedMetrics, null, 2)
    : '(none yet)';
}

function tapEnvelope(envelope: Sentry.Envelope): void {
  const items = envelope[1] as Array<[{ type?: string }, unknown]>;
  for (const [headers, payload] of items) {
    if (headers?.type === 'trace_metric') {
      // payload is { items: SerializedMetric[] }
      const metricItems = (payload as { items?: unknown[] })?.items ?? [];
      for (const m of metricItems) {
        capturedMetrics.push(m);
        // eslint-disable-next-line no-console
        console.log('[trace_metric]', m);
      }
      renderCaptured();
    }
  }
}

function capturingTransport(options: Sentry.BrowserTransportOptions): Sentry.Transport {
  const base = Sentry.makeFetchTransport(options);
  return {
    ...base,
    send(envelope) {
      try {
        tapEnvelope(envelope);
      } catch (e) {
        console.error('tap error', e);
      }
      return base.send(envelope);
    },
  };
}

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || 'https://examplePublicKey@o0.ingest.sentry.io/0',
  release: 'web-vitals-metrics-emit@1.0.0',
  environment: 'exploration',
  tracesSampleRate: 1.0,
  enableMetrics: true,
  transport: capturingTransport,
  integrations: [Sentry.browserTracingIntegration()],
});

document.getElementById('status')!.textContent =
  'ready — interact, then watch the captured metrics (and your Sentry project)';

// ---------------------------------------------------------------------------
// Helpers mirroring what the browser SDK puts on web-vital spans today.
// (packages/browser-utils/src/metrics/webVitalSpans.ts)
// ---------------------------------------------------------------------------

// Minimal htmlTreeAsString-style selector — the real SDK uses a richer version,
// but the *attribute* (a CSS-ish path string) is what matters for the list.
function selector(node: Node | null | undefined): string | undefined {
  if (!node || !(node instanceof Element)) return undefined;
  const el = node as Element;
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? `.${el.className.trim().split(/\s+/).join('.')}`
    : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

const routeName = (): string => location.pathname;

// The pageload span id — web-vital metrics correlate to the pageload span.
function pageloadSpanId(): string | undefined {
  const span = Sentry.getActiveSpan();
  if (!span) return undefined;
  const root = Sentry.getRootSpan(span);
  const json = Sentry.spanToJSON(root);
  return json.op === 'pageload' ? json.span_id : undefined;
}

const UA = navigator.userAgent;

// Attributes common to every web-vital metric (mirrors _emitWebVitalSpan).
// `origin` follows the precedent set by nodeRuntimeMetrics / elementTiming: the
// emitter sets `sentry.origin` explicitly (the core pipeline never invents one),
// matching the existing web-vital *span* origins.
function common(origin: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    'sentry.origin': origin,
    'sentry.transaction': routeName(),
    'user_agent.original': UA,
    'sentry.pageload.span_id': pageloadSpanId(),
    ...extra,
  };
}

function emit(name: string, value: number, unit: string, attributes: Record<string, unknown>): void {
  // strip undefined so the captured shape is clean
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attributes)) if (v !== undefined) attrs[k] = v;
  Sentry.metrics.distribution(name, value, { unit, attributes: attrs });
}

// ---------------------------------------------------------------------------
// Web-vital handlers. reportAllChanges so values arrive without waiting for
// the page to be hidden (easier to observe).
// ---------------------------------------------------------------------------

onLCP((metric: LCPMetric) => {
  const entry = metric.entries[metric.entries.length - 1];
  emit('browser.web_vital.lcp', metric.value, 'millisecond', common('auto.http.browser.lcp', {
    'browser.web_vital.lcp.rating': metric.rating,
    'browser.web_vital.lcp.element': selector(entry?.element),
    'browser.web_vital.lcp.id': entry?.id || undefined,
    'browser.web_vital.lcp.url': entry?.url || undefined,
    'browser.web_vital.lcp.size': entry?.size,
    'browser.web_vital.lcp.load_time': entry?.loadTime,
    'browser.web_vital.lcp.render_time': entry?.renderTime,
  }));
}, { reportAllChanges: true });

onCLS((metric: CLSMetric) => {
  const entry = metric.entries[metric.entries.length - 1];
  const sources: Record<string, unknown> = {};
  entry?.sources?.forEach((s, i) => {
    sources[`browser.web_vital.cls.source.${i + 1}`] = selector(s.node);
  });
  emit('browser.web_vital.cls', metric.value, 'none', common('auto.http.browser.cls', {
    'browser.web_vital.cls.rating': metric.rating,
    ...sources,
  }));
}, { reportAllChanges: true });

onINP((metric: INPMetric) => {
  const entry = metric.entries[metric.entries.length - 1];
  emit('browser.web_vital.inp', metric.value, 'millisecond', common('auto.http.browser.inp', {
    'browser.web_vital.inp.rating': metric.rating,
    'browser.web_vital.inp.target': selector(entry?.target),
    'browser.web_vital.inp.type': entry?.name,
  }));
}, { reportAllChanges: true });

onFCP((metric: FCPMetric) => {
  emit('browser.web_vital.fcp', metric.value, 'millisecond', common('auto.http.browser.fcp', {
    'browser.web_vital.fcp.rating': metric.rating,
  }));
});

onTTFB((metric: TTFBMetric) => {
  const nav = metric.entries[0];
  emit('browser.web_vital.ttfb', metric.value, 'millisecond', common('auto.http.browser.ttfb', {
    'browser.web_vital.ttfb.rating': metric.rating,
    'browser.web_vital.ttfb.request_time': nav ? nav.responseStart - nav.requestStart : undefined,
  }));
});

// ---------------------------------------------------------------------------
// Interaction triggers so LCP/CLS/INP actually fire in an automated run.
// ---------------------------------------------------------------------------

// Set the LCP image after load to a real, large image (data URI so no network).
const hero = document.getElementById('hero') as HTMLImageElement;
const c = document.createElement('canvas');
c.width = 640; c.height = 360;
const ctx = c.getContext('2d')!;
const grad = ctx.createLinearGradient(0, 0, 640, 360);
grad.addColorStop(0, '#6c5ce7'); grad.addColorStop(1, '#00cec9');
ctx.fillStyle = grad; ctx.fillRect(0, 0, 640, 360);
ctx.fillStyle = '#fff'; ctx.font = '48px sans-serif';
ctx.fillText('LCP hero', 200, 190);
hero.src = c.toDataURL('image/png');

document.getElementById('btn-cls')!.addEventListener('click', () => {
  const target = document.getElementById('cls-target')!;
  const block = document.createElement('div');
  block.id = 'cls-injected';
  block.style.height = '160px';
  block.textContent = 'Injected block — pushes content down → layout shift';
  target.appendChild(block);
});

document.getElementById('btn-inp')!.addEventListener('click', () => {
  // Block the main thread to inflate interaction latency → INP.
  const start = performance.now();
  while (performance.now() - start < 300) { /* busy wait */ }
});

document.getElementById('btn-flush')!.addEventListener('click', () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

document.getElementById('btn-dump')!.addEventListener('click', () => {
  // eslint-disable-next-line no-console
  console.log('ALL CAPTURED METRICS:', JSON.stringify(capturedMetrics, null, 2));
  renderCaptured();
});
