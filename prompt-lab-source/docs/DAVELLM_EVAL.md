# Library Tests against DaveLLM models

`scripts/eval-davellm.mjs` runs saved Library Test cases through the local models on Dave's DaveLLM cluster and reports how each model did. It is DaveLLM brief DL-EVAL-01, milestone 2. The app, extension, site and hosted proxy do not change.

## What it does

For each model, for each case, the script:

1. Builds the Enhance payload exactly as the app's Library Test does (`buildSystemPrompt(mode, ALL_TAGS)`, `max_tokens` 4,096, temperature 0.4).
2. Runs the app's PII gate (`scanSensitiveData`) on that payload. A blocked case is recorded and never sent.
3. Sends it to DaveLLM's stateless `POST /eval/chat`, which writes no conversation, cost, embedding or performance row.
4. Parses the reply with `parseEnhancedPayload` and scores it with `checkTraits`, the app's own functions.

It refuses a node or model that DaveLLM's `GET /nodes` and `GET /nodes/{id}/models` do not list, before calling any model.

## Run it

Node 22 is required (`scripts/require-node.mjs`). Export a workspace from Prompt Lab first; the file carries `testCases[]`.

```bash
cd prompt-lab-source
export DAVE_API_KEY='<the DaveLLM key>'
npm run eval:davellm -- --input ~/Downloads/prompt-lab-workspace.json \
  --node walter --models llama3:latest,gpt-oss:20b --dry-run
```

`--dry-run` checks the inventory and the PII gate and calls no model. Drop it for the real run. Defaults follow D-EVAL-04 A and D-EVAL-05 A: the first 10 cases, one pass, `max_tokens` 4,096, and `format: "json"`. `--no-format` sends no format, `--cases`/`--case-ids` change the selection, and `--router` points at a router other than `http://127.0.0.1:8000`. `--help` lists every option.

A live run calls real models. On DaveLLM it stays Dave-gated (milestone 3).

## The report

The script writes `eval-davellm-<time>.json` and `.md` beside the input, never overwriting an earlier report. Per model it reports:

| Column | Meaning |
|---|---|
| pass, fail | Scored by `checkTraits`; pass rate counts only these |
| unscored | The case has no expected or banned phrases |
| blocked | The PII gate stopped the case before any send |
| invalid JSON | The reply finished but does not parse |
| no enhanced | Valid JSON without an `enhanced` prompt; the app errors on these too |
| truncated | The reply ran out of `max_tokens` before a complete `enhanced` prompt |
| empty, tool call only | No visible content came back |
| errors, skipped | Router or node failures, and cases after an early stop |

Missed and banned phrases, generated tokens, `done_reason` and latency are listed per case. When `format: "json"` was sent, the report says so: the app's own Ollama adapter sends no `format`, so those pass rates are not what the app's Ollama provider would get.

A model stops early when its first case runs out of `max_tokens` or comes back empty, or when the router cannot reach the node. The remaining cases are marked skipped.
