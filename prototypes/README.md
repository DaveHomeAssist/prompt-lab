# Prompt Lab prototypes

Personal, single-page tools rebuilt from the April 2026 `html pages/` archive
(git tags `archive/library-v2-and-packs-2026-04` and
`archive/abtest-union-2026-04`). They are not part of any shipped shell and
are not deployed. Open a page straight from disk; nothing needs building.

| Page | What it does | Network |
| --- | --- | --- |
| [thread-namer.html](thread-namer.html) | Turns a thread summary into a `[emoji][emoji] \| title – MM-DD` name for a project, with custom projects and saved history | Claude, OpenAI or Gemini with your key |
| [prompt-explorer.html](prompt-explorer.html) | Branches an image prompt along one axis at a time, as a tree you can edit, pin, import and export | Claude with your key |
| [prompt-library-v2.html](prompt-library-v2.html) | Local prompt library: collections, tags, versions, `{{variable}}` fill-in, starter packs and test runs | Claude with your key (test runs only) |
| [prompt-research.html](prompt-research.html) | The Run Object research: vendor tracking, storage trade-off and the proposed v1 schema | Chart.js from cdnjs (falls back to tables offline) |

## Keys and data

- Keys are entered under **API keys** and kept in this browser's
  `localStorage` (or in memory only, if you untick *Remember on this device*).
  All pages in this folder share them. They are sent only to the provider
  being called.
- Claude calls go straight from the browser to the Messages API with
  `anthropic-dangerous-direct-browser-access`, API version `2026-10-21`,
  default model `claude-opus-5-5`, and server-side refusal fallbacks
  turned on (`fallbacks: "default"`) for the models that support them.
- Libraries, trees, history and settings live in `localStorage` under the
  `proto:` prefix. Export from each page to back them up.
- OpenAI and Gemini default model IDs in Thread Namer are editable and were not
  checked against those providers' current model lists.

## Shared files

`shared/proto.css` and `shared/proto.js` hold the theme (light by default,
toggle in the top bar), the key dialog, the Claude client, toasts and the
phone tab rail. Every page locks to the viewport: panels scroll inside
themselves and phones switch panels from the bottom rail.

## Acceptance checks

- Each page loads with no console errors from `file://`, defaults to light,
  and toggles to dark.
- No page-level scroll at 1440×900 or 375×812.
- Without a key, AI actions explain what is missing and open the key dialog
  instead of failing silently.
- Model output and imported files are only ever rendered as escaped text.
- Data survives a reload.
