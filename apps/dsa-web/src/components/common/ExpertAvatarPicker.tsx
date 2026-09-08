import { useRef, useState } from 'react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { ExpertAvatar } from './ExpertAvatar';

import { prepareExpertAvatar } from '../../utils/expertAvatar';

export function ExpertAvatarPicker({ id, name, value, onChange, disabled = false, onProcessingChange }: { id?: number; name: string; value?: string | null; onChange: (value: string | null) => void; disabled?: boolean; onProcessingChange?: (loading: boolean) => void }) {
  const { localize: l } = useUiLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  return <div className="my-4 flex flex-wrap items-center gap-4">
    <ExpertAvatar id={id} name={name || l('默认专家头像', 'Default expert avatar')} avatar={value} size={64} />
    <div className="min-w-0 flex-1"><p className="mb-2 text-sm font-medium">{l('专家头像', 'Expert avatar')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary relative cursor-pointer focus-within:ring-2 focus-within:ring-primary">{loading ? l('正在处理…', 'Processing…') : l('上传头像', 'Upload avatar')}
          <input aria-label={l('上传头像', 'Upload avatar')} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || loading} className="absolute inset-0 w-full cursor-pointer opacity-0" onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
            const current = ++revision.current; setLoading(true); onProcessingChange?.(true); setError('');
            try { const avatar = await prepareExpertAvatar(file); if (current === revision.current) onChange(avatar); }
            catch { if (current === revision.current) setError(l('请选择有效的 PNG、JPG 或 WebP 图片，不超过 5 MB、4000 万像素。', 'Choose a valid PNG, JPG or WebP image, up to 5 MB and 40 megapixels.')); }
            finally { if (current === revision.current) { setLoading(false); onProcessingChange?.(false); } }
          }} />
        </label>
        <button type="button" aria-pressed={!value} disabled={disabled} className="min-h-11 text-sm text-primary underline-offset-4 hover:underline" onClick={() => { revision.current++; setLoading(false); onProcessingChange?.(false); setError(''); onChange(null); }}>{l('使用默认头像', 'Use default avatar')}</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-secondary-text">{l('不上传即可使用默认头像；图片将居中裁剪，保存为 160 × 160。', 'Optional. Images are center-cropped and saved at 160 × 160. A default avatar is used otherwise.')}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  </div>;
}
