import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import LibraryWorkspace from '../LibraryWorkspace.jsx';
vi.mock('../lib/legacyLibraryMigration.js', async original => ({ ...(await original()), shouldAttemptLegacyWebMigration: () => false }));
afterEach(() => { cleanup(); localStorage.clear(); });
function Harness() {
  const lib = usePromptLibrary(vi.fn());
  const [visible, setVisible] = useState(true);
  return <><button onClick={() => setVisible(value => !value)}>Switch workspace</button>{visible && lib.libReady && <LibraryWorkspace lib={lib} m={{}} loadEntry={vi.fn()} copy={vi.fn()} />}</>;
}
it('retains collection, tag and status results and matching chips across workspace remounts', async () => {
  localStorage.setItem('pl2-library', JSON.stringify([
    { id: 'creative', title: 'Creative prompt', original: 'Creative body', collection: 'Creative', tags: ['Writing'], metadata: { status: 'active' } },
    { id: 'code', title: 'Code prompt', original: 'Code body', collection: 'Code', tags: ['Code'], metadata: { status: 'draft' } },
  ]));
  localStorage.setItem('pl2-collections', JSON.stringify(['Creative', 'Code']));
  render(<Harness />);
  fireEvent.click(await screen.findByTitle('Creative'));
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'active' } });
  const roundTrip = () => { fireEvent.click(screen.getByText('Switch workspace')); fireEvent.click(screen.getByText('Switch workspace')); };
  roundTrip();
  expect(screen.getByRole('button', { name: 'Inspect Creative prompt' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Inspect Code prompt' })).not.toBeInTheDocument();
  expect(screen.getByText('Collection: Creative')).toBeInTheDocument();
  expect(screen.getByLabelText('Filter by status')).toHaveValue('active');
  fireEvent.click(screen.getByRole('button', { name: 'Clear all', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '#Code', exact: true }));
  roundTrip();
  expect(screen.getByRole('button', { name: 'Inspect Code prompt' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Inspect Creative prompt' })).not.toBeInTheDocument();
  expect(screen.getByText('Tag: Code')).toBeInTheDocument();
});
