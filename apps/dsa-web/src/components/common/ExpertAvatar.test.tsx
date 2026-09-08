import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExpertAvatar } from './ExpertAvatar';

describe('ExpertAvatar', () => {
  it('uses a stable local illustration without an upload', () => {
    const { rerender } = render(<ExpertAvatar id={-1001} name="专家" />);
    const original = screen.getByRole('img').innerHTML;
    rerender(<ExpertAvatar id={-1001} name="Expert" />);
    expect(screen.getByRole('img').innerHTML).toBe(original);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Expert');
  });
  it('falls back when an uploaded image fails, and retries a replacement', () => {
    const { rerender } = render(<ExpertAvatar name="Expert" avatar="data:image/png;base64,AAAA" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img').tagName.toLowerCase()).toBe('svg');
    rerender(<ExpertAvatar name="Expert" avatar="data:image/png;base64,BBBB" />);
    expect(screen.getByRole('img').tagName.toLowerCase()).toBe('img');
  });
  it('never loads remote or SVG avatars', () => {
    render(<ExpertAvatar name="Expert" avatar="https://example.com/avatar.png" />);
    expect(screen.getByRole('img').tagName.toLowerCase()).toBe('svg');
  });
});
