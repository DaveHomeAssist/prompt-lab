import { useState } from 'react';
import Ic from './icons.jsx';
import { ARTWORK_ICONS, MAX_ARTWORK_BYTES, safeArtwork } from './lib/libraryPresentation.js';

export function Artwork({ value, fallback = 'FileText' }) {
  const artwork = safeArtwork(value);
  return <span className="pl-artwork" aria-hidden="true">{artwork.image
    ? <img src={artwork.image} alt="" /> : <Ic n={artwork.icon || fallback} size={18} />}</span>;
}

export default function ArtworkPicker({ value, onChange, disabled = false, label = 'Artwork' }) {
  const [error, setError] = useState('');
  const artwork = safeArtwork(value);
  const readImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_ARTWORK_BYTES) {
      setError('Choose a PNG, JPEG or WebP image up to 64 KB.'); return;
    }
    try {
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      if (!safeArtwork({ image }).image) throw new Error('Invalid image');
      onChange({ ...artwork, image }); setError('');
    } catch { setError('This image could not be read. Try another file.'); }
  };
  return <fieldset className="pl-artwork-picker" disabled={disabled}>
    <legend>{label}</legend>
    <div className="pl-artwork-options">{ARTWORK_ICONS.map(icon => <button key={icon} type="button" aria-label={`${label}: ${icon}`} aria-pressed={!artwork.image && artwork.icon === icon} onClick={() => onChange({ icon, image: '' })}><Ic n={icon} size={16} /></button>)}</div>
    <Artwork value={artwork} />
    <label className="pl-artwork-upload">Choose image<input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${label} image`} onChange={readImage} /></label>
    <small>PNG, JPEG or WebP · up to 64 KB · stored locally</small>
    <button type="button" onClick={() => { onChange({ icon: '', image: '' }); setError(''); }}>Clear artwork</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
