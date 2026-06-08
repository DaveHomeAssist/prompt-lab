import { describe, expect, it, vi } from 'vitest';
import {
  detectDuplicates,
  detectEmptyPrompts,
  importPresetPack,
  preparePresetPackImport,
  validatePresetPack,
} from '../lib/presetImport.js';

function buildPack(overrides = {}) {
  return {
    version: '1.0.0',
    type: 'prompt-pack',
    id: 'sample-pack',
    title: 'Sample Pack',
    presets: [
      {
        id: 'preset-one',
        title: 'Navigation Simplification',
        prompt: 'You are an information architect. Simplify the navigation.',
        summary: 'Audit the current nav.',
        tags: ['ux'],
        category: 'Information Architecture',
      },
    ],
    ...overrides,
  };
}

describe('validatePresetPack', () => {
  it('accepts a valid preset pack', () => {
    const result = validatePresetPack(buildPack());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('returns errors for missing required pack fields', () => {
    const result = validatePresetPack({ type: 'prompt-pack', presets: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'Missing required pack field: version',
      'Missing required pack field: id',
      'Missing required pack field: title',
    ]));
  });

  it('warns when optional preset metadata is missing', () => {
    const result = validatePresetPack(buildPack({
      presets: [{ id: 'p1', title: 'Preset', prompt: 'Prompt body' }],
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('missing optional field: summary'),
      expect.stringContaining('missing optional field: tags'),
      expect.stringContaining('missing optional field: category'),
    ]));
  });
});

describe('preparePresetPackImport', () => {
  it('coerces exported library JSON into a preset pack', () => {
    const exportPayload = {
      version: '1.7.0',
      schemaVersion: 1,
      exportedAt: '2026-06-08T12:00:00.000Z',
      library: [
        {
          id: 'saved-one',
          title: 'Saved Prompt',
          original: 'Original saved prompt',
          enhanced: 'Enhanced saved prompt',
          notes: 'Saved notes',
          tags: ['ops'],
          collection: 'Operations',
        },
      ],
    };

    const result = preparePresetPackImport(exportPayload);

    expect(result.sourceType).toBe('library-export');
    expect(result.validation.valid).toBe(true);
    expect(result.pack).toEqual(expect.objectContaining({
      type: 'prompt-pack',
      title: 'Prompt Library Export',
      presets: [
        expect.objectContaining({
          id: 'saved-one',
          title: 'Saved Prompt',
          prompt: 'Enhanced saved prompt',
          original: 'Original saved prompt',
          enhanced: 'Enhanced saved prompt',
          summary: 'Saved notes',
          category: 'Operations',
          tags: ['ops'],
        }),
      ],
    }));
  });

  it('coerces starter-library bundles into collection-backed presets', () => {
    const bundle = {
      meta: { format_version: '1.0' },
      libraries: [
        {
          id: 'lib_show_ops',
          name: 'Show Ops',
          prompts: [
            {
              id: 'run-sheet',
              title: 'Run Sheet Builder',
              category: 'production',
              tags: ['show'],
              prompt: 'Build a show run sheet.',
            },
          ],
        },
      ],
    };

    const result = preparePresetPackImport(bundle);

    expect(result.sourceType).toBe('starter-library-bundle');
    expect(result.validation.valid).toBe(true);
    expect(result.pack.presets).toEqual([
      expect.objectContaining({
        id: 'run-sheet',
        title: 'Run Sheet Builder',
        prompt: 'Build a show run sheet.',
        category: 'Show Ops',
        metadata: expect.objectContaining({
          source: 'starter-library',
          packId: 'lib_show_ops',
          seedPromptId: 'run-sheet',
          category: 'production',
        }),
      }),
    ]);
  });

  it('coerces raw prompt arrays into importable presets', () => {
    const result = preparePresetPackImport([
      {
        id: 42,
        title: 'Raw Prompt',
        enhanced: 'Prompt body from an array.',
        collection: 'Raw Imports',
      },
    ]);

    expect(result.sourceType).toBe('prompt-array');
    expect(result.validation.valid).toBe(true);
    expect(result.pack.presets[0]).toEqual(expect.objectContaining({
      id: '42',
      prompt: 'Prompt body from an array.',
      category: 'Raw Imports',
    }));
  });
});

describe('detectDuplicates', () => {
  it('flags similar titles above the configured threshold', () => {
    const incoming = [{ id: 'a', title: 'Prompt Navigation Cleanup', prompt: 'one' }];
    const existing = [{ id: 'b', title: 'Navigation Cleanup Prompt', enhanced: 'two' }];
    const result = detectDuplicates(incoming, existing);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'title-similar',
        a: expect.objectContaining({ id: 'a' }),
        b: expect.objectContaining({ id: 'b' }),
      }),
    ]));
  });

  it('flags exact prompt text matches by prompt hash', () => {
    const text = 'A'.repeat(220);
    const incoming = [{ id: 'a', title: 'A', prompt: text }];
    const existing = [{ id: 'b', title: 'B', enhanced: text }];
    const result = detectDuplicates(incoming, existing);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'prompt-exact-match',
        similarity: 1,
      }),
    ]));
  });
});

describe('detectEmptyPrompts', () => {
  it('returns presets with blank prompt text', () => {
    const presets = [
      { id: 'a', prompt: '   ' },
      { id: 'b', prompt: 'Hello world' },
      { id: 'c', prompt: '\n\t' },
    ];
    expect(detectEmptyPrompts(presets).map((item) => item.id)).toEqual(['a', 'c']);
  });
});

describe('importPresetPack', () => {
  it('imports presets, skips exact prompt duplicates, and resolves ID collisions', async () => {
    const existingLibrary = [
      {
        id: 'preset-one',
        title: 'Existing prompt',
        original: 'same prompt body',
        enhanced: 'same prompt body',
        createdAt: '2026-03-18T00:00:00.000Z',
      },
      {
        id: 'preset-two',
        title: 'Different prompt',
        original: 'different body',
        enhanced: 'different body',
        createdAt: '2026-03-18T00:00:01.000Z',
      },
    ];
    const save = vi.fn().mockResolvedValue(true);
    const pack = buildPack({
      presets: [
        {
          id: 'preset-one',
          title: 'Existing prompt',
          prompt: 'same prompt body',
          summary: 'duplicate',
          tags: ['dup'],
          category: 'General',
        },
        {
          id: 'preset-two',
          title: 'Fresh prompt',
          prompt: 'new prompt body',
          summary: 'import me',
          tags: ['new'],
          category: 'General',
          status: 'ready',
          inputs: [
            {
              key: 'model',
              label: 'Model',
              type: 'select',
              required: true,
              options: ['GPT-5', 'GPT-5 mini'],
            },
          ],
        },
        {
          id: 'preset-empty',
          title: 'Empty prompt',
          prompt: '   ',
          summary: 'skip me',
          tags: ['empty'],
          category: 'General',
        },
      ],
    });

    const result = await importPresetPack(pack, {
      load: async () => existingLibrary,
      save,
    });

    expect(result.imported).toEqual([
      expect.objectContaining({ id: 'preset-two-imported', title: 'Fresh prompt' }),
    ]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'preset-one', reason: 'prompt-exact-match' }),
      expect.objectContaining({ id: 'preset-empty', reason: 'empty-prompt' }),
    ]));
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'prompt-exact-match' }),
      expect.objectContaining({ reason: 'id-collision', a: expect.objectContaining({ id: 'preset-two' }) }),
    ]));
    expect(save).toHaveBeenCalledTimes(1);
    const savedLibrary = save.mock.calls[0][0];
    expect(savedLibrary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'preset-two-imported',
        title: 'Fresh prompt',
        enhanced: 'new prompt body',
        inputs: [
          {
            key: 'model',
            label: 'Model',
            type: 'select',
            required: true,
            placeholder: '',
            options: [
              { label: 'GPT-5', value: 'GPT-5' },
              { label: 'GPT-5 mini', value: 'GPT-5 mini' },
            ],
          },
        ],
      }),
    ]));
  });

  it('returns validation failures as skipped items without saving', async () => {
    const save = vi.fn();
    const result = await importPresetPack({ title: 'Bad pack' }, { save });
    expect(result.imported).toEqual([]);
    expect(result.skipped).not.toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it('imports Prompt Lab library export files through the pack importer', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const result = await importPresetPack({
      version: '1.7.0',
      exportedAt: '2026-06-08T12:00:00.000Z',
      library: [
        {
          id: 'exported-one',
          title: 'Exported Prompt',
          original: 'Old text',
          enhanced: 'Prompt text from export',
          notes: 'Exported notes',
          tags: ['export'],
          collection: 'Exports',
        },
      ],
    }, {
      load: async () => [],
      save,
    });

    expect(result.sourceType).toBe('library-export');
    expect(result.imported).toEqual([
      expect.objectContaining({ id: 'exported-one', title: 'Exported Prompt' }),
    ]);
    expect(save).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        id: 'exported-one',
        title: 'Exported Prompt',
        original: 'Old text',
        enhanced: 'Prompt text from export',
        notes: 'Exported notes',
        collection: 'Exports',
        tags: ['export'],
        metadata: expect.objectContaining({
          source: 'library-export',
          owner: 'Prompt Library Export',
        }),
      }),
    ]));
  });

  it('imports a single starter library JSON file through the pack importer', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const result = await importPresetPack({
      id: 'lib_field_ops',
      name: 'Field Ops',
      prompts: [
        {
          id: 'field-check',
          title: 'Field Check',
          category: 'verification',
          tags: ['field'],
          prompt: 'Build a field verification checklist.',
        },
      ],
    }, {
      load: async () => [],
      save,
    });

    expect(result.sourceType).toBe('starter-library');
    expect(result.imported).toEqual([
      expect.objectContaining({ id: 'field-check', title: 'Field Check' }),
    ]);
    expect(save).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        title: 'Field Check',
        collection: 'Field Ops',
        enhanced: 'Build a field verification checklist.',
        metadata: expect.objectContaining({
          source: 'starter-library',
          packId: 'lib_field_ops',
          seedPromptId: 'field-check',
          category: 'verification',
        }),
      }),
    ]));
  });
});
