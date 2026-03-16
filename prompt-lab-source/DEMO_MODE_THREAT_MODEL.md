# Demo Mode Threat Model

Prompt Lab demo mode uses the hosted web proxy in [`prompt-lab-web/api/proxy.js`](./prompt-lab-web/api/proxy.js) to inject provider API keys server-side for approved upstream domains only.

- A client can choose the request body and target provider path, but not an arbitrary hostname.
- The proxy only forwards to `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, and `openrouter.ai`.
- Any client-supplied provider credentials are overwritten by server-side environment keys before the upstream request is sent.
- Server-side injection can authorize requests to approved provider APIs; it cannot execute shell commands, read repo files, or fetch arbitrary internet targets.
- Prompt injection inside model input can still influence model output. It cannot make the proxy step outside the allowlist.
- Abuse is constrained by a per-IP limit of `30` requests per `60` seconds in the edge function.
- The proxy accepts `POST` only, requires HTTPS targets, and rejects malformed JSON or blocked domains early.
- Upstream providers still enforce their own quotas, moderation, and account-level spending rules after the proxy forwards a request.
- Demo mode should be treated as low-trust public input with capped spend, not as an authenticated private control plane.
