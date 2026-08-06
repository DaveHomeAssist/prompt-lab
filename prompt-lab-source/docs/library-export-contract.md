# Prompt Lab Library Export Contract

The native Prompt Lab export is a JSON object with `type: "prompt-lab-library"` and `schemaVersion: 1`.

Required top-level fields:

| Field | Type | Purpose |
|---|---|---|
| `type` | string | Native format identifier. |
| `version` | string | Prompt Lab version that created the export. |
| `schemaVersion` | number | Export contract version. |
| `exportedAt` | ISO timestamp | Export creation time. |
| `count` | number | Number of records. |
| `library` | array | Complete normalized prompt records. |
| `collections` | string array | Collection names, including empty collections. |

Prompt records retain IDs, content, variants, notes, tags, versions, test cases, golden responses, timestamps, inputs, and metadata. Import must normalize records through `promptSchema.js` but must not discard unknown metadata fields.

The canonical round-trip fixture is `prompt-lab-extension/src/tests/fixtures/native-library-export.json`. Changes to this contract require a new schema version and migration test.

Library persistence is separate from the export format. Local persistence uses the revisioned `pl2-library-envelope` record and mirrors `pl2-library` plus `pl2-collections` for backward compatibility.
