// REVIEW-2026-11-25 High: mobile generation used to send only the first 150
// characters of the task and the first 3 requirement bullets.
import { describe, expect, it } from 'vitest';
import { buildCopyReadyPromptPayload } from '../../../prompt-lab-web/mobile/mobileProvider.js';
import { parsePromptIntent } from '../../../prompt-lab-web/mobile/mobileState.js';

const userContent = (payload) => payload.messages[0].content;

describe('mobile copy-ready payload', () => {
  it('sends a long unstructured source whole', () => {
    const source = `Write a migration plan for our billing service. ${'Keep every invoice reconciled during the cutover. '.repeat(12)}End with a rollback checklist.`;
    const content = userContent(buildCopyReadyPromptPayload(source));
    expect(content).toContain(source);
    expect(content).toContain('End with a rollback checklist.');
    expect(content).not.toContain('...');
  });

  it('sends every requirement and the sections around the task', () => {
    const source = [
      'Task: Draft a launch announcement for the new sync feature.',
      'Requirements:',
      '- Mention desktop',
      '- Mention extension',
      '- Mention iOS',
      '- Mention the web app',
      '- Keep it under 200 words',
      'Context: The audience is existing Pro customers.',
    ].join('\n');
    const content = userContent(buildCopyReadyPromptPayload(source));
    for (const line of ['- Mention the web app', '- Keep it under 200 words']) expect(content).toContain(line);
    expect(content).toContain('Context: The audience is existing Pro customers.');
  });

  it('keeps the short form for display', () => {
    const intent = parsePromptIntent(`Task: ${'x'.repeat(400)}\nRequirements:\n- a\n- b\n- c\n- d`);
    expect(intent.task.length).toBe(152);
    expect(intent.task.endsWith('...')).toBe(true);
    expect(intent.requirements).toEqual(['a', 'b', 'c']);
  });
});
