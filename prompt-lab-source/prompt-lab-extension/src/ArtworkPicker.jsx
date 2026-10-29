import { useEffect, useRef, useState } from 'react';
import Ic from './icons.jsx';
import { useRecentArtwork } from './lib/recentArtwork.js';
import { ARTWORK_ICONS, MAX_ARTWORK_BYTES, safeArtwork, safeEmoji } from './lib/libraryPresentation.js';

export function Artwork({ value, fallback = 'FileText' }) {
  const artwork = safeArtwork(value);
  const [failedImage, setFailedImage] = useState('');
  return <span className="pl-artwork" aria-hidden="true">{artwork.image && failedImage !== artwork.image
    ? <img src={artwork.image} alt="" onError={() => setFailedImage(artwork.image)} /> : artwork.emoji ? <span className="pl-artwork-emoji">{artwork.emoji}</span> : <Ic n={artwork.icon === 'Code' ? 'Braces' : artwork.icon || fallback} size={18} />}</span>;
}

export function ArtworkControls({ value, onChange, disabled = false, label = 'Artwork', onReadyChange }) {
  const [error, setError] = useState('');
  const recent = useRecentArtwork();
  const artwork = safeArtwork(value);
  const [emojiInput, setEmojiInput] = useState(artwork.emoji || '');
  const [reading, setReading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setEmojiInput(artwork.emoji || ''); }, [artwork.emoji, artwork.icon, artwork.image]);
  useEffect(() => { onReadyChange?.(!reading && (!emojiInput || Boolean(safeEmoji(emojiInput)))); }, [reading, emojiInput, onReadyChange]);
  const readImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_ARTWORK_BYTES) {
      setError('Choose a PNG, JPEG or WebP image up to 64 KB.'); return;
    }
    setReading(true);
    try {
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      if (!safeArtwork({ image }).image) throw new Error('Invalid image');
      if (mounted.current) { onChange({ ...artwork, image, emoji: '' }); setError(''); }
    } catch { if (mounted.current) setError('This image could not be read. Try another file.'); }
    finally { if (mounted.current) setReading(false); }
  };
  return <fieldset className="pl-artwork-picker" disabled={disabled || reading}>
    <legend>{label}</legend>
    {recent.entries.length > 0 && <div className="pl-artwork-recents">
      <div className="pl-artwork-recents-heading"><strong>Recently used</strong><button type="button" onClick={recent.clear}>Clear recently used</button></div>
      <div className="pl-artwork-options" role="group" aria-label={`${label} recently used`}>
        {recent.entries.map((item, index) => <button type="button" key={item.image || item.emoji || item.icon} aria-label={`Use recent ${item.image ? `image ${index + 1}` : item.emoji || item.icon}`} onClick={() => { onChange(item); setError(''); }}><Artwork value={item} /></button>)}
      </div>
    </div>}
    {recent.error && <p role="alert">{recent.error}</p>}
    <div className="pl-artwork-options">{ARTWORK_ICONS.map(icon => <button key={icon} type="button" aria-label={`${label}: ${icon}`} aria-pressed={!artwork.image && !artwork.emoji && artwork.icon === icon} title={icon} onClick={() => { onChange({ icon, image: '' }); setError(''); }}><Ic n={icon === 'Code' ? 'Braces' : icon} size={16} /></button>)}</div>
    <label className="pl-artwork-emoji-input">Emoji<input aria-label={`${label} emoji`} value={emojiInput} placeholder="Paste one emoji" onChange={event => {
      const input = event.target.value; setEmojiInput(input);
      const emoji = safeEmoji(input);
      if (emoji) { onChange({ icon: '', image: '', emoji }); setError(''); }
      else if (!input) { onChange({ ...artwork, emoji: '' }); setError(''); }
      else setError('Choose one emoji, including a flag or a combined emoji.');
    }} /></label>
    <Artwork value={artwork} />
    <label className="pl-artwork-upload">Choose image<input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${label} image`} onChange={readImage} /></label>
    {reading && <p role="status">Reading image…</p>}
    <small>PNG, JPEG or WebP · up to 64 KB · stored locally</small>
    <button type="button" onClick={() => { onChange({ icon: '', image: '' }); setEmojiInput(''); setError(''); }}>Clear artwork</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}

export default function ArtworkPicker(props) {
  return <details className="pl-artwork-details"><summary><Artwork value={props.value} />{props.label || 'Artwork'}</summary><ArtworkControls {...props} /></details>;
}
