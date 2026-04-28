import { callModelDirect } from '../../prompt-lab-extension/src/lib/desktopApi.js';
import { extractTextFromAnthropic } from '../../prompt-lab-extension/src/promptUtils.js';
import { DEFAULTS } from '../../prompt-lab-extension/src/lib/providerRegistry.js';
import { parsePromptIntent } from './mobileState.js';

const COPY_READY_SYSTEM_PROMPT = `You generate production-ready prompts for PromptLab Mobile.

Return only a copy-and-paste-ready prompt artifact. Do not include commentary, markdown fences, analysis, greetings, or explanations.

The response must use this exact structure:

Copy-ready prompt

Role
[one sentence role instruction]

Task
[clear task instruction]

Requirements
- [requirement]
- [requirement]
- [requirement]

Output format
- [format instruction]
- [format instruction]
- [format instruction]`;

export function buildCopyReadyPromptPayload(sourceText) {
  const { task, requirements } = parsePromptIntent(sourceText);
  const requirementText = requirements.length
    ? requirements.map((item) => `- ${item}`).join('\n')
    : '- Ask only for missing context that blocks the work.\n- Return a structured answer with concise headings.\n- Include assumptions, risks, and concrete next actions.';

  return {
    model: DEFAULTS.anthropicModel,
    max_tokens: 900,
    temperature: 0.2,
    system: COPY_READY_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          'Create a copy-ready prompt from this source.',
          '',
          'Task:',
          task || sourceText,
          '',
          'Requirements:',
          requirementText,
        ].join('\n'),
      },
    ],
  };
}

export function normalizePromptArtifact(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) {
    throw new Error('Provider returned an empty prompt.');
  }

  return cleaned.startsWith('Copy-ready prompt')
    ? cleaned
    : `Copy-ready prompt\n\n${cleaned}`;
}

export async function generateCopyReadyPrompt(sourceText, { onChunk, signal } = {}) {
  const payload = buildCopyReadyPromptPayload(sourceText);
  let lastStreamText = '';

  const data = await callModelDirect(payload, {
    signal,
    onChunk: (_chunk, fullText) => {
      if (!fullText) return;
      lastStreamText = normalizePromptArtifact(fullText);
      if (typeof onChunk === 'function') onChunk(lastStreamText);
    },
  });

  const providerText = lastStreamText || extractTextFromAnthropic(data);
  return {
    text: normalizePromptArtifact(providerText),
    provider: data?.provider || 'anthropic',
    model: data?.model || payload.model,
  };
}
