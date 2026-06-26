# Web Vitals → Trace Metrics emit

A client-side (browser) app that emits LCP, CLS, INP, FCP, and TTFB as **trace metrics**
the way the SDK would once web vitals move off spans — so we can read off the full,
exact attribute list each metric carries.

- Real `@sentry/browser` metrics pipeline (`Sentry.metrics.distribution`) → real
  `trace_metric` envelope. Default attributes (`sentry.release`, `sentry.environment`,
  `sentry.sdk.*`, `sentry.timestamp.sequence`, `trace_id`, `span_id`) are attached by
  the SDK exactly as in production.
- Real `web-vitals` library for entry data (element, sources, url, size, etc.) — same
  source the SDK vendors.
- Domain attributes mirror today's web-vital **span** attributes
  (`packages/browser-utils/src/metrics/webVitalSpans.ts`), namespaced under
  `browser.web_vital.*`.

## Run

```sh
cp .env.example .env   # optional: set VITE_SENTRY_DSN to watch them land in your project
npm install
npm run dev            # http://localhost:5180
```

Click **Trigger layout shift** (CLS), **Slow click** (INP), then **Flush web vitals**
to force the final values. Captured `trace_metric` items render on the page and log to
the console; with a real DSN set, they also send to your Sentry project.
