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

    fireEvent.change(screen.getByPlaceholderText('Paste preset pack JSON…'), {
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
});
