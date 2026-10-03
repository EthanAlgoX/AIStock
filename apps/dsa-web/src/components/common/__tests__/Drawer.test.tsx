import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';
import { Drawer } from '../Drawer';
import { ConfirmDialog } from '../ConfirmDialog';

afterEach(() => { cleanup(); document.body.style.overflow = ''; });
function DrawerFlow() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>打开导航</button><button>背景操作</button><Drawer isOpen={open} onClose={() => setOpen(false)} title="导航"><a href="/runs">运行记录</a></Drawer></>;
}
function NestedFlow() {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return <Drawer isOpen={outer} onClose={() => setOuter(false)} title="父抽屉" zIndex={90}>
    <button onClick={() => setInner(true)}>打开子抽屉</button>
    <button onClick={() => setConfirm(true)}>删除配置</button>
    <Drawer isOpen={inner} onClose={() => setInner(false)} title="子抽屉" zIndex={100}><button>子操作</button></Drawer>
    <ConfirmDialog isOpen={confirm} title="确认删除" message="删除当前配置？" onCancel={() => setConfirm(false)} onConfirm={() => setConfirm(false)} />
  </Drawer>;
}
const show = (content: React.ReactNode) => render(<UiLanguageProvider>{content}</UiLanguageProvider>);

describe('Drawer keyboard ownership', () => {
  it('moves focus inside, loops Tab, rejects background focus and restores the opener and original scroll value', () => {
    document.body.style.overflow = 'clip'; show(<DrawerFlow />);
    const opener = screen.getByRole('button', { name: '打开导航' }); opener.focus(); fireEvent.click(opener);
    const close = screen.getByRole('button', { name: '关闭抽屉' });
    expect(close).toHaveFocus(); expect(document.body.style.overflow).toBe('hidden');
    screen.getByRole('link', { name: '运行记录' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' }); expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(screen.getByRole('link')).toHaveFocus();
    screen.getByRole('button', { name: '背景操作' }).focus(); expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('clip');
  });

  it('gives same-side drawers unique titles and routes Escape only to the top drawer', async () => {
    show(<NestedFlow />);
    const opener = screen.getByRole('button', { name: '打开子抽屉' }); opener.focus(); fireEvent.click(opener);
    const parent = screen.getByRole('dialog', { name: '父抽屉' });
    const child = screen.getByRole('dialog', { name: '子抽屉' });
    expect(child.getAttribute('aria-labelledby')).not.toBe(parent.getAttribute('aria-labelledby'));
    const close = within(child).getByRole('button', { name: '关闭抽屉' }); expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '子抽屉' })).not.toBeInTheDocument());
    expect(parent).toBeInTheDocument(); expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('lets a real portal confirmation own focus and Escape, then returns to its drawer action', async () => {
    show(<NestedFlow />);
    const action = screen.getByRole('button', { name: '删除配置' }); action.focus(); fireEvent.click(action);
    const confirmation = screen.getByRole('dialog', { name: '确认删除' });
    const cancel = within(confirmation).getByRole('button', { name: '取消' }); expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认删除' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: '父抽屉' })).toBeInTheDocument();
    await waitFor(() => expect(action).toHaveFocus());
  });

  it('excludes closed details and hidden ancestors from the Tab boundary while keeping the summary focusable', () => {
    show(<Drawer isOpen onClose={() => undefined} title="可见操作">
      <button>可见操作</button>
      <div hidden><button>原生隐藏操作</button></div>
      <div style={{ display: 'none' }}><button>折叠区域操作</button></div>
      <div style={{ visibility: 'hidden' }}><button>不可见操作</button></div>
      <details><summary>高级说明</summary><button>尚未展开操作</button></details>
    </Drawer>);
    const summary = screen.getByText('高级说明'); summary.focus();
    fireEvent.keyDown(summary, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '关闭抽屉' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(summary).toHaveFocus();
  });
});
