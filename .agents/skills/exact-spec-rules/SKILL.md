---
name: exact-spec-rules
description: Use when writing or reviewing validation, classification order, dedup, V(clip,t), earnings, budget allocation with the remainder rule, DLQ replay, top-clips, stats, or hostile-input handling. Contains the exact rules and the known traps.
---

# Exact spec rules (distilled from docs/ASSESSMENT.md sections 3-6; the assessment wins on any conflict)

## Outcome per line, in this order
1. invalid_schema -> DLQ (applies to every line incl. clip_text)  2. late -> counted, dropped, NEVER in DLQ
(`emitted - observed > 21,600,000 ms`, strictly)  3. unknown_campaign -> DLQ  4. accepted.
Valid `clip_text` goes to the classifier and counts in no stat.

## Validation traps
- `v` must be the number 1 or 2; `"1"`, `true`, `1.5` are invalid. Booleans are not integers anywhere.
- v1 timestamps must match `YYYY-MM-DDTHH:MM:SS.sssZ` exactly AND be real instants. Do not trust `Date.parse`;
  regex then round-trip (`new Date(s).toISOString() === s`).
- v2 timestamps and counts must be JSON integers. In JS, `JSON.parse` cannot tell `10.0` or `1e3` from `10`.
  Decide how to detect that (inspect the raw token text or use a strict parser), test it, and write the decision under README Assumptions.
- ids: `^[0-9a-f]{16}$`, `^c_\d{7}$`, `^k_\d{5}$`, `^u_\d{6}$` (anchored; `\d` must not match non-ASCII digits).
- both timestamps within [2020-01-01, 2100-01-01); views 0..2,000,000,000; `emitted >= observed`.
- v1 `type` absent or `view_snapshot`; v2 `type` is `view_snapshot` or `clip_text`. Caption <= 5,000 chars, transcript <= 20,000.
- Ignore extra fields, a trailing `\r`, empty lines. Think about: BOM, NUL bytes, invalid UTF-8, duplicate keys, array/null lines, `NaN`.
- Garbage identity: its `event_id` if the line is a JSON object with a string `event_id`, else SHA-256 of the line. Same garbage counts once.

## Dedup
Same `event_id` -> same effect as once, at any time, in any order, including via DLQ replay and re-sent files.
A clip never changes campaign or creator. No two accepted snapshots of a clip share `observed_at`.

## V and top-clips
`V(clip,t)` = views of the accepted snapshot with greatest `observed_at` STRICTLY BEFORE t, else 0. Latest observation wins even if lower
(downward revisions), even when it arrives out of order. `views_gained = V(to) - V(from)`; list only > 0; order gain desc, clip_id asc;
`from`/`to` whole hours, `to > from`, span <= 168 h else 400; limit 1..200 default 50; keyset cursor (no OFFSET); `next_cursor` null on last page.

## Earnings (integers only)
`earned_i = min(cap, floor(V(i,end_at) * cpm / 1000))`, `raw = sum`. If `raw <= budget` pay `earned_i`. Else
`paid_i = floor(earned_i*budget/raw)`, `remainder_i = (earned_i*budget) mod raw`, `left = budget - sum(paid)`;
+1 cent to the `left` clips with largest remainder, ties by `clip_id` ascending. Spend == budget exactly.
Magnitudes fit in doubles (earned*budget < 2^53) but assert `Number.isSafeInteger`; use `bigint` in Postgres.
`spend` response: `budget_exhausted = raw > budget`, `paid_clips` = clips with `paid_i > 0`; registered but not computed -> 200 with zeros; unknown -> 404.
Creator earnings: entries only where paid > 0, sorted by campaign_id; unknown creator -> 200, total 0, empty list.

## Campaign registration and replay
`POST /v1/admin/campaigns` upserts; effective the moment the 200 returns, even for events arriving immediately after.
A cached "unknown" must be re-checked against the catalog before an event goes to the DLQ.
`dlq/replay` re-classifies, never duplicates, leaves still-failing events pending; replaying `invalid_schema` changes nothing.
`stats`: distinct accepted, distinct late, DLQ pending counts per reason (distinct by identity).
