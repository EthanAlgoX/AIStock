import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpertAvatarPicker } from './ExpertAvatarPicker';
import { prepareExpertAvatar } from '../../utils/expertAvatar';

describe('ExpertAvatarPicker', () => {
  it('offers a selected default and can clear an upload', () => {
    const onChange = vi.fn();
    render(<ExpertAvatarPicker name="Expert" value="data:image/png;base64,AAAA" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '使用默认头像' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
  it('rejects invalid files without replacing the existing avatar', async () => {
    const onChange = vi.fn();
    render(<ExpertAvatarPicker name="Expert" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('上传头像'), { target: { files: [new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });
  it('rejects oversized images before decoding', async () => {
    await expect(prepareExpertAvatar(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).rejects.toThrow('size');
  });
});
