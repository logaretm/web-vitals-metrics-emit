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
| `sentry.transaction` | string | all |
| `user_agent.original` | string | all |
| `sentry.pageload.span_id` | string | LCP, CLS, FCP, TTFB (and INP when a pageload span is active) |
| `browser.web_vital.{vital}.value` | integer/double | all (mirrors the value; redundant with top-level `value`) |
| `browser.web_vital.{vital}.rating` | string | all — `good` / `needs-improvement` / `poor` (proposed; not on the span today) |

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
Only the common attributes + `value` + `rating`. No detail attributes.

### TTFB — `browser.web_vital.ttfb`, distribution, `millisecond`
| Attribute | Type | Example |
|---|---|---|
| `browser.web_vital.ttfb.request_time` | double | `3.5` (`responseStart - requestStart`) |

## What Relay should IGNORE when converting a span → metric

These exist on the web-vital **span** but are span-structural / redundant and should not
be copied onto the metric:

- `sentry.op` (e.g. `ui.webvital.lcp`, `ui.interaction.click`) — used only for *matching*
- `sentry.origin` (e.g. `auto.http.browser.lcp`) — used only for matching
- `sentry.exclusive_time` — always `0` for the zero-duration vital spans
- `sentry.segment.name`, `sentry.segment.id` — span tree structure
- span `span_id` / `parent_span_id` / `start_timestamp` / `end_timestamp` / `is_segment`
  / `status` / `links` — top-level span fields, replaced by the metric's own fields

And Relay should ADD on conversion (per RFC 0154):
- `sentry.metric.source: "span"` — provenance / billing flag (omitted on SDK-native metrics)
