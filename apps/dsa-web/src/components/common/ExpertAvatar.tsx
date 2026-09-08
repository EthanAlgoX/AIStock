import { useState } from 'react';

/** Local illustrations identify AI personas, not photographs or endorsements. */
export function ExpertAvatar({ id = 0, name, avatar, size = 36 }: { id?: number | string; name: string; avatar?: string | null; size?: number }) {
  const [failed, setFailed] = useState<string>();
  const seed = [...String(id)].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 0) >>> 0;
  const palettes = [['#e0e7ff', '#3730a3'], ['#d1fae5', '#065f46'], ['#fef3c7', '#92400e'], ['#e0f2fe', '#075985'], ['#fce7f3', '#9d174d'], ['#ede9fe', '#5b21b6']];
  const [background, ink] = palettes[seed % palettes.length];
  const hairstyle = Math.floor(seed / palettes.length) % 3;
  const safe = avatar?.startsWith('data:image/png;base64,') && avatar.length <= 180000 && avatar !== failed;
  return <span className="inline-flex shrink-0 overflow-hidden rounded-full border border-border" style={{ width: size, height: size }}>
    {safe ? <img src={avatar!} alt={name} className="h-full w-full object-cover" onError={() => setFailed(avatar!)} /> : <svg viewBox="0 0 64 64" role="img" aria-label={name} width={size} height={size}>
      <rect width="64" height="64" fill={background} />
      <path d="M8 64c1-16 10-24 24-24s23 8 24 24" fill={ink} />
      <path d="m25 43 7 12 7-12" fill="white" />
      <rect x="27" y="35" width="10" height="11" rx="4" fill="#dba987" />
      <ellipse cx="32" cy="27" rx="14" ry="17" fill={seed % 2 ? '#ebc3a5' : '#dba987'} />
      <path d={hairstyle === 0 ? 'M18 25C12 4 49 1 47 26L40 14 21 21Z' : hairstyle === 1 ? 'M18 25V16C22 2 43 4 47 18L45 27 40 16 19 20Z' : 'M18 22C16 5 46 3 47 22L41 15 22 16Z'} fill={seed % 2 ? '#596273' : '#293345'} />
      <circle cx="27" cy="27" r="1.5" fill="#293345" /><circle cx="37" cy="27" r="1.5" fill="#293345" />
      {seed % 2 === 0 && <g fill="none" stroke={ink} strokeWidth="1.5"><rect x="21" y="23" width="10" height="8" rx="3" /><rect x="33" y="23" width="10" height="8" rx="3" /><path d="M31 26h2" /></g>}
      <path d="M28 35q4 3 8 0" fill="none" stroke="#855b48" strokeWidth="1.5" strokeLinecap="round" />
    </svg>}
  </span>;
}
