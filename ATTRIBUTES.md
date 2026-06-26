# Web Vitals as Trace Metrics — full attribute list

Captured from the real `@sentry/browser@10.61.0` metrics pipeline running in Chrome
(this app emits each vital via `Sentry.metrics.distribution`). This is the **SDK wire
shape** — the exact `trace_metric` envelope item. End-storage shape can be read off the
same items in the Sentry project the DSN points to.

Attribute values on the wire are `{ "value": ..., "type": "string|integer|double|boolean" }`.
The `type` is inferred from the JS value, so **numeric web-vital values serialize as
`integer` when whole and `double` when fractional** (e.g. `lcp.value: 96` → integer,
`cls.value: 0.0900…` → double, `lcp.load_time: 70.1` → double). Relay must accept both.

## Top-level metric fields (not attributes)

| Field | Example | Notes |
|---|---|---|
| `name` | `browser.web_vital.lcp` | `…lcp` / `.cls` / `.inp` / `.fcp` / `.ttfb` |
| `type` | `distribution` | all five are distributions |
| `unit` | `millisecond` | `none` for CLS; `millisecond` for the rest |
| `value` | `96` | the vital value |
| `timestamp` | `1782416536.93` | seconds |
| `trace_id` | `7b87919d…` | always present (from active span/scope) |
| `span_id` | `be84beb0…` | present when a span is active at emit time. **Absent on INP** in this run — it reported ~30s later, after the pageload span ended. |

## Attributes on every web-vital metric

**SDK-attached automatically** (`_enrichMetricAttributes` + `_buildSerializedMetric`) — Relay does NOT copy these from the span; the SDK sets them, and on span→metric conversion Relay derives the equivalents itself:

| Attribute | Type | Source |
|---|---|---|
| `sentry.release` | string | client option |
| `sentry.environment` | string | client option |
| `sentry.sdk.name` | string | `sentry.javascript.browser` |
| `sentry.sdk.version` | string | `10.61.0` |
| `sentry.timestamp.sequence` | integer | per-metric ordering within a ms |
| `user.id` / `user.email` / `user.name` | string | only if user is set |
| `sentry.replay_id` | string | only if Replay is active |

**Domain attributes the SDK puts on the metric (these mirror the v2 web-vital span and are what Relay should copy/map):**

| Attribute | Type | On |
|---|---|---|
| `sentry.origin` | string | all — `auto.http.browser.{lcp,cls,inp,fcp,ttfb}` (set by the emitter, see below) |
| `sentry.transaction` | string | all |
| `user_agent.original` | string | all |
| `sentry.pageload.span_id` | string | LCP, CLS, FCP, TTFB (and INP when a pageload span is active) |

> **Dropped as derivable/redundant — not emitted:**
> - `browser.web_vital.{vital}.value` — duplicates the metric's top-level `value`. It exists
>   only on the **span** (spans have no value field); Relay reads it there and promotes it to
>   the metric's `value` during span→metric conversion. Native metrics don't carry it.
> - `browser.web_vital.{vital}.rating` (`good`/`needs-improvement`/`poor`) — a pure function
>   of `value` and fixed `web-vitals` thresholds, which the backend already applies to compute
>   performance scores. Recomputable from `value`, so not worth sending.

> **`sentry.origin` on metrics — precedent.** The metric *core pipeline* never invents an
> origin (just like spans: core doesn't set it, the emitter does). But emitting `sentry.origin`
> as a metric *attribute* is established: `nodeRuntimeMetrics` (`auto.node.runtime_metrics`),
> `bunRuntimeMetrics`, `denoRuntimeMetrics`, and `elementTiming` (`auto.ui.browser.element_timing`)
> all pass it. So web-vital metrics should set it too, matching the existing span origins
> (`auto.http.browser.lcp` etc.). For span→metric conversion, Relay should **copy** the span's
> `sentry.origin` so converted and native metrics carry it consistently.

## Per-vital attributes

### LCP — `browser.web_vital.lcp`, distribution, `millisecond`
| Attribute | Type | Example |
|---|---|---|
| `browser.web_vital.lcp.element` | string | `img#hero` |
| `browser.web_vital.lcp.id` | string | `hero` (only when element has an id) |
| `browser.web_vital.lcp.url` | string | `data:image/png;base64,…` / resource URL |
| `browser.web_vital.lcp.size` | integer | `230400` (px²) |
| `browser.web_vital.lcp.load_time` | double | `70.1` |
| `browser.web_vital.lcp.render_time` | integer/double | `96` |

### CLS — `browser.web_vital.cls`, distribution, `none`
| Attribute | Type | Example |
|---|---|---|
| `browser.web_vital.cls.source.1` | string | `div#shifter.shifter` |
| `browser.web_vital.cls.source.2` | string | `div.metric` |
| … `.source.N` | string | one per shift source on the largest shift entry |

### INP — `browser.web_vital.inp`, distribution, `millisecond`
| Attribute | Type | Example |
|---|---|---|
| `browser.web_vital.inp.target` | string | `button#submit` (`body` if no precise target) |
| `browser.web_vital.inp.type` | string | `pointerdown` / `click` / `keydown` |

> Note: today's INP **span** carries no element/type detail attributes (only the value +
> exclusive_time). `target`/`type` here are proposed additions. If Relay derives INP from
> the existing span, those two attributes won't be available — they only exist on
> natively-emitted metrics.

### FCP — `browser.web_vital.fcp`, distribution, `millisecond`
Only the common attributes. No detail attributes.

### TTFB — `browser.web_vital.ttfb`, distribution, `millisecond`
| Attribute | Type | Example |
|---|---|---|
| `browser.web_vital.ttfb.request_time` | double | `3.5` (`responseStart - requestStart`) |

## What Relay should IGNORE when converting a span → metric

These exist on the web-vital **span** but are span-structural / redundant and should not
be copied onto the metric:

- `browser.web_vital.{vital}.value` — **read it as the value source** and promote it to the
  metric's top-level `value` field; do **not** also copy it into the metric's `attributes`
  (it would duplicate the top-level `value`).
- `sentry.op` (e.g. `ui.webvital.lcp`, `ui.interaction.click`) — used only for *matching*
- `sentry.exclusive_time` — always `0` for the zero-duration vital spans
- `sentry.segment.name`, `sentry.segment.id` — span tree structure
- span `span_id` / `parent_span_id` / `start_timestamp` / `end_timestamp` / `is_segment`
  / `status` / `links` — top-level span fields, replaced by the metric's own fields

And Relay should ADD on conversion (per RFC 0154):
- `sentry.metric.source: "span"` — provenance / billing flag (omitted on SDK-native metrics)

## Cross-reference: develop.sentry.dev/sdk/telemetry/metrics

Verified our captured output against the trace-metric spec. Full conformance:

| Spec requirement | Captured | OK |
|---|---|---|
| Envelope item `type: "trace_metric"` | ✓ (`metrics/envelope.ts:24`) | ✅ |
| `content_type: "application/vnd.sentry.items.trace-metric+json"` | ✓ (`:26`) | ✅ |
| Payload `version: 2` | ✓ (`:29`) | ✅ |
| Required item fields: `timestamp`, `type`, `name`, `value`, `trace_id` | all present | ✅ |
| Optional: `span_id`, `unit`, `attributes` | present (`span_id` absent on INP — allowed) | ✅ |
| Metric types `counter` / `gauge` / `distribution` | `distribution` | ✅ |
| Attribute encoding `{ "value", "type" }`, types `string`/`integer`/`double`/`boolean` | exact match | ✅ |
| MUST attach `sentry.environment`, `sentry.release`, `sentry.sdk.name`, `sentry.sdk.version`, `sentry.timestamp.sequence` | all present | ✅ |
| PII-guarded `user.id/name/email` (needs `sendDefaultPii`) | not set (correct) | ✅ |
| `server.address` (backend SDKs only) | N/A (browser) | ✅ |
| Name = hierarchical, dot-separated | `browser.web_vital.lcp` | ✅ |

