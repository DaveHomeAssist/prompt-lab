# r/PromptEngineering Post

**Title:** I built a prompt engineering workbench with A/B testing, version history, and template variables

**Body:**

After months of pasting prompts between ChatGPT, Claude, and Gemini tabs to compare results, I built a tool to do it properly.

**Prompt Lab** is a workbench for prompt engineers who want to iterate systematically instead of guessing. It runs as a web app or Chrome extension — no backend, no account, your API keys stay in your browser.

**Core workflow:**

1. Write or paste a prompt
2. Enhance it with one click (uses your active provider)
3. A/B test it against two models side-by-side
4. Save to your library with tags and version history
5. Pin a "Golden Response" as your benchmark and diff future iterations against it

**What I think makes it different:**

- **Template variables** — `{{role}}`, `{{context}}`, `{{clipboard}}` — write once, reuse across scenarios
- **Version history with inline diff** — see exactly what you changed and when, restore any prior version
- **Test cases** — define expected traits and exclusions, run them against any model
- **5 providers** from one UI — Anthropic, OpenAI, Gemini, OpenRouter, Ollama

**Links:**

- Try it: https://promptlab.tools/app
- Starter templates: https://promptlab.tools/templates/ (importable JSON — code review, tech writing, API docs)
- Source: https://github.com/DaveHomeAssist/prompt-lab-provider-options

Would love feedback from anyone doing structured prompt optimization — what's missing from your workflow?
