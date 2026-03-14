# r/LocalLLaMA Post

**Title:** I built a prompt workbench with Ollama support — test local models alongside cloud providers from one panel

**Body:**

I've been working on Prompt Lab, a prompt engineering workbench that now supports Ollama alongside Anthropic, OpenAI, Gemini, and OpenRouter.

The idea: instead of switching between different UIs to compare how local vs. cloud models handle the same prompt, you do it in one place.

**What makes it useful for local LLM users:**

- Point it at your Ollama instance and test any loaded model
- A/B test a local model against a cloud model side-by-side (e.g., Llama 3 vs. Claude)
- Template variables — write a prompt once with `{{placeholders}}`, fill them differently per run
- Version history with diff — see exactly what changed when you tweak a prompt
- Everything runs client-side. No backend, no accounts, no data leaves your machine

**How to try it:**

- Web app: https://promptlab.tools/app (works in any browser)
- Chrome extension: install from the setup page for a persistent side panel
- Source: https://github.com/DaveHomeAssist/prompt-lab-provider-options

For Ollama, just set your base URL in settings (defaults to `localhost:11434`). Any model you've pulled shows up in the model dropdown.

Curious how others are testing prompts against local models — what's your workflow?
