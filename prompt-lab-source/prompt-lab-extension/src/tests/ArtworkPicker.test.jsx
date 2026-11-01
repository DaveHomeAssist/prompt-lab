import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberArtwork } from '../lib/recentArtwork.js';
import ArtworkPicker, { Artwork } from '../ArtworkPicker.jsx';
import { safeArtwork, safeEmoji, ARTWORK_ICONS, MAX_ARTWORK_BYTES } from '../lib/libraryPresentation.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
function Picker() {
  const [value, setValue] = useState({ icon: 'Star' });
  return <><ArtworkPicker value={value} onChange={setValue} label="Prompt artwork" /><output>{JSON.stringify(value)}</output></>;
}
describe('artwork choices and validation', () => {
  it.each(['🧪', '👩🏽‍💻', '🇨🇦', '1️⃣', '👨‍👩‍👧‍👦'])('retains a single emoji sequence %s', emoji => {
    expect(safeEmoji(emoji)).toBe(emoji);
    expect(safeArtwork({ emoji }).emoji).toBe(emoji);
  });
  it.each(['hello', '🧪⭐', '', 'a', '1', '<script>'])('rejects non-emoji or multiple choices %s', value => expect(safeEmoji(value)).toBe(''));
  it('keeps legacy shape and rejects remote or SVG images', () => {
    expect(safeArtwork({ icon: 'Star' })).toEqual({ icon: 'Star', image: '' });
    expect(safeArtwork({ image: 'https://example.com/a.png' }).image).toBe('');
    expect(safeArtwork({ image: 'data:image/svg+xml;base64,AAAA' }).image).toBe('');
    expect(ARTWORK_ICONS.length).toBeGreaterThan(10);
  });
  it('replaces emoji with an icon and clears all artwork', () => {
    render(<Picker />);
    fireEvent.click(document.querySelector('summary'));
    fireEvent.change(screen.getByLabelText('Prompt artwork emoji'), { target: { value: '👩🏽‍💻' } });
    expect(document.querySelector('output').textContent).toContain('👩🏽‍💻');
    fireEvent.click(screen.getByRole('button', { name: 'Prompt artwork: Clock', exact: true }));
    expect(screen.getByLabelText('Prompt artwork emoji')).toHaveValue('');
    expect(document.querySelector('output').textContent).toContain('Clock');
    fireEvent.click(screen.getByRole('button', { name: 'Clear artwork' }));
    expect(document.querySelector('output').textContent).toBe('{"icon":"","image":""}');
  });
  it('preserves existing artwork on invalid and oversized upload, then accepts and clears an image', async () => {
    render(<Picker />); fireEvent.click(document.querySelector('summary'));
    const upload = file => fireEvent.change(screen.getByLabelText('Prompt artwork image'), { target: { files: [file] } });
    upload(new File(['bad'], 'bad.svg', { type: 'image/svg+xml' }));
    expect(screen.getByRole('alert')).toHaveTextContent('up to 64 KB');
    expect(document.querySelector('output')).toHaveTextContent('Star');
    upload(new File([new Uint8Array(MAX_ARTWORK_BYTES + 1)], 'big.png', { type: 'image/png' }));
    expect(screen.getByRole('alert')).toHaveTextContent('up to 64 KB');
    vi.spyOn(window, 'Image').mockImplementation(function () { return { decode: () => Promise.resolve(), naturalWidth: 1, naturalHeight: 1 }; });
    upload(new File(['small'], 'small.png', { type: 'image/png' }));
    await waitFor(() => expect(document.querySelector('output')).toHaveTextContent('data:image/png;base64,'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear artwork' }));
    expect(document.querySelector('output')).toHaveTextContent('{"icon":"","image":""}');
  });
  it('renders image before emoji and falls back after image failure', () => {
    const { container } = render(<Artwork value={{ icon: 'Star', emoji: '🧪', image: 'data:image/png;base64,AAAA' }} />);
    expect(container.querySelector('img')).toBeTruthy();
    fireEvent.error(container.querySelector('img'));
    expect(container).toHaveTextContent('🧪');
  });
});

it('reuses a saved image in a collection picker without asking for another file', () => {
  const image = 'data:image/png;base64,AAAA'; rememberArtwork({ image });
  let chosen; render(<ArtworkPicker label="Collection artwork" onChange={value => { chosen = value; }} />);
  fireEvent.click(document.querySelector('summary'));
  fireEvent.click(screen.getByRole('button', { name: 'Use recent image 1' }));
  expect(chosen.image).toBe(image);
  expect(JSON.parse(localStorage.getItem('pl2-recent-artwork'))).toHaveLength(1);
});

it('keeps existing artwork and reports a damaged image decode failure', async () => {
  vi.spyOn(window, 'Image').mockImplementation(function () { return { decode: () => Promise.reject(new Error('decode failed')) }; });
  render(<Picker />); fireEvent.click(document.querySelector('summary'));
  fireEvent.change(screen.getByLabelText('Prompt artwork image'), { target: { files: [new File(['broken'], 'broken.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be read'));
  expect(document.querySelector('output')).toHaveTextContent('Star');
  expect(screen.getByLabelText('Prompt artwork image')).not.toBeDisabled();
});

it('pins and removes individual recent choices without selecting or clearing assigned artwork', async () => {
  rememberArtwork({ icon: 'Clock' }); rememberArtwork({ emoji: '🧪' });
  render(<Picker />); fireEvent.click(document.querySelector('summary'));
  fireEvent.click(screen.getByRole('button', { name: 'Pin recent 🧪' }));
  expect(screen.getByRole('button', { name: 'Unpin recent 🧪' })).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('output')).toHaveTextContent('Star');
  fireEvent.click(screen.getByRole('button', { name: 'Clear recently used' }));
  expect(screen.getByRole('button', { name: 'Use recent 🧪' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use recent Clock' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove recent 🧪' }));
  expect(screen.queryByRole('button', { name: 'Use recent 🧪' })).not.toBeInTheDocument();
  expect(document.querySelector('output')).toHaveTextContent('Star');
  await waitFor(() => expect(screen.getByLabelText('Prompt artwork emoji')).toHaveFocus());
});
