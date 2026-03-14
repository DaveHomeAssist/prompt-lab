# Show HN: Prompt Lab — multi-provider prompt engineering workbench

**Title:** Show HN: Prompt Lab — A/B test prompts across Anthropic, OpenAI, Gemini, and Ollama

**URL:** https://promptlab.tools

**Text:**

I built Prompt Lab because I was tired of keeping five AI tabs open to test the same prompt across different models.

It's a prompt engineering workbench that runs as a web app (promptlab.tools/app) or Chrome extension. You bring your own API keys — they stay in localStorage, never touch a server.

What it does:

- **A/B Testing** — run the same prompt against two models side-by-side and compare output
- **One-click Enhance** — refine any prompt using your active provider
- **Template Variables** — define placeholders like `{{role}}` or `{{clipboard}}` that fill at runtime
- **Prompt Library** — save, tag, version, and search your prompts with full change history
- **Golden Response** — pin a reference output and diff future iterations against it
- **5 providers** — Anthropic, OpenAI, Gemini, OpenRouter, Ollama (local models)

No backend. No account. No telemetry. The entire thing runs client-side.

Built with React, Vite, Tailwind. Source is on GitHub: https://github.com/DaveHomeAssist/prompt-lab-provider-options

I'd love feedback on the workflow — especially from anyone doing systematic prompt optimization.
