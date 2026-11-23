# Project profiles

Status: active

A project profile is a short block of instructions Prompt Lab sends with Run, Enhance, and Rewrite. It is a system preamble. It is not written into the prompt you are editing.

Profiles are stored on this device, next to the Library, under `pl2-project-profiles` at schema version 1. Nothing in the app bundle installs a personal profile. The manager can import one generic profile, and that profile is labelled Example.

## What a profile holds

| Field | Required | Limit |
|---|---|---|
| `id` | No. Prompt Lab assigns one when it is missing. | Unique string |
| `name` | Yes | 80 characters |
| `emoji` | No | A short emoji |
| `color` | No | `orange`, `violet`, `blue`, `green`, `amber`, `rose`, or `slate` |
| `instructions` | No | 1,500 characters. The editor shows an approximate token count at about 4 characters per token. |
| `defaultTags` | No | Up to 12 tags. Added when a new prompt is saved while the profile is active. |
| `outputFormat` | No | 400 characters |
| `example` | No | `true` only for the labelled example |

Use an emoji or a color, or neither. The active profile is the one with `"selected": true` in local storage. The import file does not need that field.

## Import file

`schemaVersion` 1 and `kind` `prompt-lab-project-profiles`. A newer `schemaVersion` is refused. A bare array of profiles is also accepted.

A pack profile may name the format field `outputHints` (a string, or a list of strings). Import copies that text into `outputFormat` when `outputFormat` is empty. When both are present, `outputFormat` is kept. The imported text is part of the system preamble, so the existing sensitive-data scan still reads it before a run is sent.

```json
{
  "schemaVersion": 1,
  "kind": "prompt-lab-project-profiles",
  "profiles": [
    {
      "id": "example-project",
      "name": "Example project",
      "example": true,
      "emoji": "📘",
      "color": "blue",
      "instructions": "Write for a general software project. Use plain language, name the audience when it matters, prefer terms already used in the prompt, and do not invent a stack, deadline, or product name that was not given. Keep the answer specific and ready to use.",
      "defaultTags": ["example"],
      "outputFormat": "Short sections with the direct answer first."
    }
  ]
}
```

The same list is included as `projectProfiles` on a Prompt Lab workspace export and restored by workspace import. Profiles already on the device are kept. A matching id keeps the copy with the newer `updatedAt`.

## How a profile is sent

When a profile is active, Run (Compare, chat, and chain runs), Enhance, and Rewrite prepend:

```text
Project profile: Example project
<instructions>

Output format: <output format>
```

The prompt text in the editor is unchanged. Preview what gets sent shows this preamble. Profile off for this run leaves the payload as it was and records no profile on the next save.

A saved prompt stores `profileId` and `profileName` for the profile that was active. Library can filter by that profile. If a prompt's tags or folder match a profile's name or default tags, Library and the header suggest it.
