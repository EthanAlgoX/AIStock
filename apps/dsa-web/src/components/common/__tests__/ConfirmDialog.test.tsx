import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';
import { ConfirmDialog } from '../ConfirmDialog';

function renderDialog(overrides: Partial<ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <UiLanguageProvider>
      <ConfirmDialog
        isOpen
        title="确认操作"
        message="确认继续吗？"
        confirmText="确定"
        cancelText="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...overrides}
      />
    </UiLanguageProvider>,
  );
  return { onConfirm, onCancel, ...result };
}

describe('ConfirmDialog', () => {
  it('returns keyboard focus to the action after Escape closes its confirmation', () => {
    function Flow() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>删除计划</button><ConfirmDialog isOpen={open} title="确认删除" message="确认删除该计划？" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} /></>;
    }
    render(<UiLanguageProvider><Flow /></UiLanguageProvider>);
    const opener = screen.getByRole('button', { name: '删除计划' });
    opener.focus();
    fireEvent.click(opener);
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('disables confirm and cancel actions independently', () => {
    const { onConfirm, onCancel } = renderDialog({
      confirmDisabled: true,
      cancelDisabled: true,
    });

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(document.body.lastElementChild as HTMLElement);

    expect(screen.getByRole('button', { name: '确定' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps both Tab directions inside a confirmation with no enabled buttons', () => {
    renderDialog({ confirmDisabled: true, cancelDisabled: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(dialog).toHaveFocus();
  });

  it('reenters enabled actions after an in-flight operation without losing the original opener', async () => {
    let finish!: () => void;
    const request = new Promise<void>(resolve => { finish = resolve; });
    function Flow() {
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      return <><button onClick={() => setOpen(true)}>删除计划</button><ConfirmDialog
        isOpen={open} title="确认删除" message="确认删除该计划？" confirmText="删除"
        confirmDisabled={busy} cancelDisabled={busy} onCancel={() => setOpen(false)}
        onConfirm={() => { setBusy(true); void request.then(() => setBusy(false)); }} /></>;
    }
    render(<UiLanguageProvider><Flow /></UiLanguageProvider>);
    const opener = screen.getByRole('button', { name: '删除计划' });
    opener.focus(); fireEvent.click(opener);
    const confirm = screen.getByRole('button', { name: '删除' });
    confirm.focus(); fireEvent.click(confirm);
    const dialog = screen.getByRole('dialog');
    expect(confirm).toBeDisabled();
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(dialog).toHaveFocus();
    await act(async () => finish());
    expect(confirm).toBeEnabled();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    dialog.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps the default confirm and cancel behavior when not disabled', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
