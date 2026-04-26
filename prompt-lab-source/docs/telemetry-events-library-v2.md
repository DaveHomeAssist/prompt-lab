# Telemetry — Library v2 events

**Status:** PROPOSED — names below are pending sign-off from the analytics owner before they hit the warehouse. Rename in the call sites (`App.jsx`, `useLibraryTweaks.js`) before merging the rename downstream.

**Source:** Phase 4 of `implementation-plan-library-v2-and-packs-2026-04-25.md`.

---

## New event

### `library.tweak_changed`

Fires when the user changes any of the three Library v2 visual axes (density, accent, row signature). One event per **validated transition** — no-op writes (same value as current, or invalid value coerced to current) do **not** emit.

**Properties**

| Name  | Type   | Notes                                                                 |
|-------|--------|-----------------------------------------------------------------------|
| axis  | string | `density` \| `accent` \| `signature`                                  |
| from  | string | The previous validated preset key.                                    |
| to    | string | The new validated preset key.                                         |

**Emitted from:** [hooks/useLibraryTweaks.js](../prompt-lab-extension/src/hooks/useLibraryTweaks.js) via the `onChange` callback wired in [App.jsx](../prompt-lab-extension/src/App.jsx) (search for `library.tweak_changed`).

**Why one event with `axis` instead of three:** matches the existing `domain.verb_in_past_tense` convention in the codebase (`library.prompt_loaded`, `library.export_requested`, `composer.block_added`). One event = one warehouse table to query; the `axis` discriminator is cheap to filter on.

---

## Bumped event

### `library.prompt_loaded`

Existing event. **Three new properties added** so steady-state preset distribution can be derived without joining against the transition stream.

**New properties**

| Name      | Type   | Notes                                                                                |
|-----------|--------|--------------------------------------------------------------------------------------|
| density   | string | Currently active density preset (`compact` \| `default` \| `expanded` \| `gallery`). |
| accent    | string | Currently active accent preset (`violet` \| `ink` \| `citrus` \| `sunset` \| `forest`). |
| signature | string | Currently active row-signature preset (`cards` \| `rail` \| `ticket` \| `manuscript`). |

**Emitted from:** [App.jsx `handleLoadEntry`](../prompt-lab-extension/src/App.jsx) (search for `library.prompt_loaded`).

**Notes**
- Reflects the **stored** axis values, not the rendered ones. The compact-shell density fallback (extension side-panel forces `default`) is not echoed in telemetry — preserves the user's intent over the rendering accommodation.
- No PII. No prompt body, no titles, no IDs. Axis values are bounded enums.

---

## Querying the dataset

Useful aggregations once events arrive in the warehouse:

```sql
-- Steady-state distribution of each axis among active users (last 7 days)
SELECT axis_name, axis_value, COUNT(DISTINCT user_id) AS users
FROM (
  SELECT user_id, 'density'   AS axis_name, density   AS axis_value FROM library_prompt_loaded
  UNION ALL
  SELECT user_id, 'accent'    AS axis_name, accent    AS axis_value FROM library_prompt_loaded
  UNION ALL
  SELECT user_id, 'signature' AS axis_name, signature AS axis_value FROM library_prompt_loaded
)
WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY 1, 2
ORDER BY 1, users DESC;

-- Most-changed axis (transition volume)
SELECT axis, COUNT(*) AS transitions
FROM library_tweak_changed
WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY 1
ORDER BY transitions DESC;

-- Preset stickiness: users who left vs. kept the v2 defaults
SELECT
  to_value AS chosen_preset,
  COUNT(DISTINCT user_id) AS users_who_changed_to
FROM library_tweak_changed
WHERE axis = 'density' AND from_value = 'gallery'
GROUP BY 1
ORDER BY users_who_changed_to DESC;
```

---

## Privacy posture

Both events are bounded-cardinality enum streams. No prompt content, no API keys, no titles. Existing telemetry consent gate (`telemetry.telemetryEnabled`) gates emission — if a user opted out of insights, neither event fires.

## Renaming protocol

When the analytics owner finalizes names:

1. Update the event-name string literals in `useLibraryTweaks.js` (call site is in `App.jsx`) and `App.jsx`'s `handleLoadEntry`.
2. Update this doc.
3. Coordinate with the warehouse team — events emitted under the old name during the rollover window should be backfilled or aliased.
