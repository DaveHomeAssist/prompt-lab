import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CommandPaletteModal from '../modals/CommandPaletteModal.jsx';
import ShortcutsModal from '../modals/ShortcutsModal.jsx';
import SettingsModal from '../modals/SettingsModal.jsx';
import TemplateVariablesModal from '../modals/TemplateVariablesModal.jsx';
import PiiWarningModal from '../modals/PiiWarningModal.jsx';
import DiffPane from '../DiffPane.jsx';
import VersionDiffModal from '../VersionDiffModal.jsx';

const theme = {
  modalBg: 'modal-bg',
  modal: 'modal',
  border: 'border',
  text: 'text',
  textMuted: 'text-muted',
  textAlt: 'text-alt',
  textSub: 'text-sub',
  textBody: 'text-body',
  btn: 'button',
  surface: 'surface',
  input: 'input',
  pill: 'pill',
  codeBlock: 'code',
  diffAdd: 'add',
  diffDel: 'delete',
  diffEq: 'equal',
};

describe('shared modal accessibility', () => {
  it('focuses the command search, contains Tab, closes with Escape, and restores focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open commands</button>
          {open && (
            <CommandPaletteModal
              m={theme}
              cmdQuery={query}
              setCmdQuery={setQuery}
              filteredCmds={[
                { label: 'New prompt', action: vi.fn() },
                { label: 'Open Scratch', action: vi.fn() },
              ]}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open commands' });
    trigger.focus();
    fireEvent.click(trigger);

    const search = screen.getByRole('textbox', { name: 'Search commands' });
    await waitFor(() => expect(search).toHaveFocus());
    const last = screen.getByRole('button', { name: 'Open Scratch' });

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(search).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('gives shortcut and settings dialogs complete accessible names and controls', () => {
    const first = render(<ShortcutsModal m={theme} primaryModKey="⌘" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toHaveAccessibleDescription();
    expect(screen.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Open Dual Pane')).toBeInTheDocument();
    first.unmount();

    render(
      <SettingsModal
        m={theme}
        showNotes
        setShowNotes={vi.fn()}
        density="comfortable"
        setDensity={vi.fn()}
        collections={['Launch']}
        deleteCollection={vi.fn()}
        exportLib={vi.fn()}
        importLib={vi.fn()}
        clearLibrary={vi.fn()}
        openOptions={vi.fn()}
        onClose={vi.fn()}
        telemetry={{ telemetryEnabled: true, contactEmail: '' }}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveAccessibleDescription();
    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Delete Launch collection' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Billing or contact email' })).toHaveAttribute('type', 'email');
  });

  it('restores Settings to its persistent header opener after an intermediate dialog handoff', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      const triggerRef = useRef(null);
      return (
        <>
          <button ref={triggerRef} type="button">Header settings</button>
          {open && (
            <SettingsModal
              m={theme}
              showNotes
              setShowNotes={vi.fn()}
              density="comfortable"
              setDensity={vi.fn()}
              collections={[]}
              deleteCollection={vi.fn()}
              exportLib={vi.fn()}
              importLib={vi.fn()}
              clearLibrary={vi.fn()}
              openOptions={vi.fn()}
              onClose={() => setOpen(false)}
              returnFocusRef={triggerRef}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close settings' })).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Header settings' })).toHaveFocus());
  });

  it('labels template fields and initially focuses the safer sensitive-data action', async () => {
    const templateView = render(
      <TemplateVariablesModal
        m={theme}
        varVals={{ audience: '' }}
        setVarVals={vi.fn()}
        pendingTemplate={{ title: 'Launch brief' }}
        pendingTemplateInputMap={{ audience: { label: 'Audience' } }}
        applyTemplate={vi.fn()}
        skipTemplate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Fill Template Variables' })).toHaveAccessibleDescription();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Audience' })).toHaveFocus());
    templateView.unmount();

    render(
      <PiiWarningModal
        m={theme}
        piiWarning={{ matches: [{ id: 'email-1', type: 'email', snippet: 'person@example.com' }] }}
        piiRedactAndSend={vi.fn()}
        piiSendAnyway={vi.fn()}
        piiCancel={vi.fn()}
      />,
    );

    const redact = screen.getByRole('button', { name: 'Redact & Send' });
    await waitFor(() => expect(redact).toHaveFocus());
    expect(screen.getByRole('dialog', { name: 'Sensitive Data Detected' })).toHaveAccessibleDescription();
    expect(screen.getByRole('list', { name: 'Detected sensitive items' })).toBeInTheDocument();
  });

  it('exposes comparison controls and selected version state', () => {
    const diffView = render(
      <DiffPane textA="Use one tone." textB="Use a concise tone." onClose={vi.fn()} copy={vi.fn()} m={theme} />,
    );
    expect(screen.getByRole('dialog', { name: 'A/B Output Comparison' })).toHaveAccessibleDescription();
    expect(screen.getByRole('button', { name: 'Synchronize scrolling: on' })).toHaveAttribute('aria-pressed', 'true');
    diffView.unmount();

    render(
      <VersionDiffModal
        entry={{
          id: 'prompt-1',
          title: 'Launch prompt',
          original: 'Original current',
          enhanced: 'Enhanced current',
          notes: '',
          versions: [{
            id: 'version-1',
            savedAt: '2026-08-20T12:00:00.000Z',
            original: 'Original old',
            enhanced: 'Enhanced old',
            notes: '',
          }],
        }}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        m={theme}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Launch prompt' })).toHaveAccessibleDescription('1 saved snapshot');
    expect(screen.getByRole('button', { name: /Snapshot 1/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Close version history' })).toBeInTheDocument();
  });
});
