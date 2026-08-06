import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PresetImportPanel from '../PresetImportPanel.jsx';

vi.mock('../icons', () => ({
  default: ({ n }) => <span>{n}</span>,
}));

vi.mock('../DraftBadge.jsx', () => ({
  default: ({ children }) => <span>{children}</span>,
}));

function makeTheme() {
  return {
    surface: 'surface',
    border: 'border',
    codeBlock: 'code-block',
    text: 'text',
    textSub: 'text-sub',
    textAlt: 'text-alt',
    textBody: 'text-body',
    textMuted: 'text-muted',
    input: 'input',
    btn: 'btn',
  };
}

function buildPack(overrides = {}) {
  return {
    version: '1.0.0',
    type: 'prompt-pack',
    id: 'ui-pack',
    title: 'UI Pack',
    presets: [
      {
        id: 'nav-audit',
        title: 'Navigation Audit',
        prompt: 'Audit {{surface}}',
        summary: 'Review navigation structure',
        category: 'UX',
        tags: ['ux'],
        inputs: [
          {
            key: 'surface',
            label: 'Surface',
            type: 'select',
            options: ['Dashboard', 'Sidebar'],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('PresetImportPanel', () => {
  it('shows invalid JSON and keeps import disabled', () => {
    render(
      <PresetImportPanel
        m={makeTheme()}
        lib={{
          library: [],
          setLibrary: vi.fn(),
          setCollections: vi.fn(),
        }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Paste preset pack or library JSON...'), {
      target: { value: '{"version":' },
    });

    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import Presets/i })).toBeDisabled();
  });

  it('previews pasted JSON and imports merged library entries', async () => {
    const setLibrary = vi.fn();
    const setCollections = vi.fn();

    render(
      <PresetImportPanel
        m={makeTheme()}
        lib={{
          library: [],
          setLibrary,
          setCollections,
        }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Paste preset pack or library JSON...'), {
      target: { value: JSON.stringify(buildPack()) },
    });

    expect(screen.getByText('UI Pack')).toBeInTheDocument();
    expect(screen.getByText('Navigation Audit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Import Presets/i }));

    await waitFor(() => expect(setLibrary).toHaveBeenCalledTimes(1));
    expect(setCollections).toHaveBeenCalledTimes(1);
    expect(setCollections.mock.calls[0][0](['Existing'])).toEqual(['Existing', 'UX']);
    expect(setLibrary.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Navigation Audit',
        collection: 'UX',
        inputs: [
          expect.objectContaining({
            key: 'surface',
            type: 'select',
          }),
        ],
      }),
    ]));
  });

  it('commits confirmed imports through the revisioned repository path', async () => {
    const commitLibrarySnapshot = vi.fn();

    render(
      <PresetImportPanel
        m={makeTheme()}
        lib={{
          library: [],
          collections: ['Existing'],
          commitLibrarySnapshot,
        }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Paste preset pack or library JSON...'), {
      target: { value: JSON.stringify(buildPack()) },
    });
    expect(commitLibrarySnapshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Import Presets/i }));

    await waitFor(() => expect(commitLibrarySnapshot).toHaveBeenCalledTimes(1));
    expect(commitLibrarySnapshot).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'Navigation Audit' })]),
      ['Existing', 'UX'],
      { backupReason: 'pre-preset-import' },
    );
  });

  it('previews and imports raw prompt arrays', async () => {
    const setLibrary = vi.fn();
    const setCollections = vi.fn();

    render(
      <PresetImportPanel
        m={makeTheme()}
        lib={{
          library: [],
          setLibrary,
          setCollections,
        }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Paste preset pack or library JSON...'), {
      target: {
        value: JSON.stringify([
          {
            id: 'raw-import',
            title: 'Raw Import Prompt',
            prompt: 'Convert this rough request into a concise implementation checklist.',
            collection: 'Raw Imports',
            tags: ['raw'],
          },
        ]),
      },
    });

    expect(screen.getByText('Prompt array')).toBeInTheDocument();
    expect(screen.getByText('Raw Import Prompt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Import Presets/i }));

    await waitFor(() => expect(setLibrary).toHaveBeenCalledTimes(1));
    expect(setCollections.mock.calls[0][0]([])).toEqual(['Raw Imports']);
    expect(setLibrary.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Raw Import Prompt',
        enhanced: 'Convert this rough request into a concise implementation checklist.',
        collection: 'Raw Imports',
      }),
    ]));
  });

  it('previews and imports exported library JSON through the pack panel', async () => {
    const setLibrary = vi.fn();
    const setCollections = vi.fn();
    const exportedLibrary = {
      version: '1.7.0',
      exportedAt: '2026-06-08T12:00:00.000Z',
      library: [
        {
          id: 'exported-nav',
          title: 'Exported Navigation Prompt',
          original: 'Original body',
          enhanced: 'Imported exported body',
          notes: 'Exported summary',
          collection: 'Exports',
          tags: ['export'],
        },
      ],
    };

    render(
      <PresetImportPanel
        m={makeTheme()}
        lib={{
          library: [],
          setLibrary,
          setCollections,
        }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Paste preset pack or library JSON...'), {
      target: { value: JSON.stringify(exportedLibrary) },
    });

    expect(screen.getByText('Library export')).toBeInTheDocument();
    expect(screen.getByText('Exported Navigation Prompt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Import Presets/i }));

    await waitFor(() => expect(setLibrary).toHaveBeenCalledTimes(1));
    expect(setCollections.mock.calls[0][0]([])).toEqual(['Exports']);
    expect(setLibrary.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Exported Navigation Prompt',
        enhanced: 'Imported exported body',
        collection: 'Exports',
      }),
    ]));
  });

  it('reports exact duplicate skips in the import result', async () => {
    const existing = {
      id: 'existing-nav',
      title: 'Existing Navigation Audit',
      original: 'Audit {{surface}}',
      enhanced: 'Audit {{surface}}',
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z',
    };
    const setLibrary = vi.fn();

    render(
      <PresetImportPanel
        m={makeTheme()}
        lib={{
          library: [existing],
          setLibrary,
          setCollections: vi.fn(),
        }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Paste preset pack or library JSON...'), {
      target: { value: JSON.stringify(buildPack()) },
    });

    expect(screen.getByText('Exact match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Import Presets/i }));

    await waitFor(() => expect(screen.getByText('0 imported, 1 skipped')).toBeInTheDocument());
  });

  it('shows save failures without clearing the import draft', async () => {
    const setLibrary = vi.fn(() => {
      throw new Error('Storage quota exceeded');
    });

    render(
      <PresetImportPanel
        m={makeTheme()}
        lib={{
          library: [],
          setLibrary,
          setCollections: vi.fn(),
        }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Paste preset pack or library JSON...'), {
      target: { value: JSON.stringify(buildPack()) },
    });
    fireEvent.click(screen.getByRole('button', { name: /Import Presets/i }));

    await waitFor(() => expect(screen.getByText('Import failed')).toBeInTheDocument());
    expect(screen.getByText(/Storage quota exceeded/)).toBeInTheDocument();
    expect(screen.getByText('Navigation Audit')).toBeInTheDocument();
  });
});
