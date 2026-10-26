import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import seedData from '../data/promptlab-seed-libraries.json';
import imagePack from '../../../prompt-lab-web/public/packs/image-generation.json';
import engineeringPack from '../../../prompt-lab-web/public/packs/prompt-engineering.json';
import { getStarterLibraries, loadStarterPack } from '../lib/seedTransform.js';
import { preparePresetPackImport, buildImportEntries } from '../lib/presetImport.js';
import TemplateVariablesModal from '../modals/TemplateVariablesModal.jsx';

const theme = { modalBg: '', modal: '', text: '', textSub: '', textAlt: '', input: '', btn: '' };
const metaPack = seedData.libraries.find((pack) => pack.name === 'Prompt Engineering Meta-Toolkit');

beforeEach(() => localStorage.clear());

describe('recovered optional image pack', () => {
  it('validates through the real importer and retains all 34 prompts and input definitions', () => {
    const result = preparePresetPackImport(imagePack);
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);
    expect(imagePack.presets).toHaveLength(34);
    expect(new Set(imagePack.presets.map((p) => p.id)).size).toBe(34);
    expect(new Set(imagePack.presets.map((p) => p.title)).size).toBe(34);
    const { entries } = buildImportEntries(result.pack);
    expect(entries).toHaveLength(34);
    expect(entries.every((entry) => entry.original.trim())).toBe(true);
    imagePack.presets.forEach((preset, index) => {
      expect(entries[index].inputs).toMatchObject(preset.inputs);
    });
    expect(getStarterLibraries().some((pack) => pack.id === imagePack.id)).toBe(false);
  });
});

describe('starter content integrity and template inputs', () => {
  it('provides a reviewable engineering update for users who already loaded the starters', () => {
    expect(preparePresetPackImport(engineeringPack).validation.errors).toEqual([]);
    expect(engineeringPack.presets.map(({ id, prompt, inputs }) => ({ id, prompt, inputs })))
      .toEqual(metaPack.prompts.map(({ id, prompt, inputs }) => ({ id, prompt, inputs })));
  });

  it('keeps global identities, declared counts, and visible library counts consistent', () => {
    const ids = seedData.libraries.flatMap((pack) => pack.prompts.map((prompt) => prompt.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(seedData.libraries.map((pack) => pack.id)).size).toBe(seedData.libraries.length);
    seedData.libraries.forEach((pack) => expect(pack.prompt_count).toBe(pack.prompts.length));
    expect(getStarterLibraries()).toHaveLength(seedData.libraries.filter((pack) => pack.prompts.length).length);
  });

  it('loads all 12 existing engineering prompts with required multiline inputs and unchanged identities', () => {
    const existing = [{ id: 'user-record', title: 'My unrelated draft', original: 'Keep this content', enhanced: 'Keep this content' }];
    const before = structuredClone(existing);
    const loaded = loadStarterPack(metaPack.id, existing, []);
    expect(metaPack.prompts).toHaveLength(12);
    expect(existing).toEqual(before);
    metaPack.prompts.forEach((prompt) => {
      const entry = loaded.library.find((item) => item.metadata?.seedPromptId === prompt.id);
      expect(entry.inputs).toMatchObject(prompt.inputs);
      const tokens = [...prompt.prompt.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)].map((match) => match[1]);
      expect(tokens.length).toBeGreaterThan(0);
      expect(new Set(prompt.inputs.map((input) => input.key))).toEqual(new Set(tokens));
      expect(prompt.inputs.every((input) => input.required && input.type === 'textarea')).toBe(true);
    });
    expect(loadStarterPack(metaPack.id, loaded.library, loaded.collections)).toBeNull();
  });

  it('accepts multiline prompt content and requires every comparison input before Apply', () => {
    const entry = metaPack.prompts.find((p) => p.title === 'Original vs Enhanced Comparison');
    const apply = vi.fn();
    function Form() {
      const [values, setValues] = useState(Object.fromEntries(entry.inputs.map((input) => [input.key, ''])));
      return <TemplateVariablesModal m={theme} pendingTemplate={entry} varVals={values} setVarVals={setValues}
        pendingTemplateInputMap={Object.fromEntries(entry.inputs.map((input) => [input.key, input]))}
        applyTemplate={() => apply(values)} skipTemplate={vi.fn()} onClose={vi.fn()} />;
    }
    render(<Form />);
    const button = screen.getByRole('button', { name: 'Apply Template' });
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.every((input) => input.tagName === 'TEXTAREA')).toBe(true);
    expect(button).toBeDisabled();
    inputs.forEach((input, index) => fireEvent.change(input, { target: { value: `Prompt ${index}\nSecond line` } }));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(Object.values(apply.mock.calls[0][0])).toEqual(['Prompt 0\nSecond line', 'Prompt 1\nSecond line']);
  });
});
