import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PriceAlertPanel from './PriceAlertPanel';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';

const api = vi.hoisted(() => ({ status: vi.fn(), listRules: vi.fn(), listTriggers: vi.fn(), listNotifications: vi.fn(), createRule: vi.fn(), updateRule: vi.fn(), testRule: vi.fn() }));
vi.mock('../../api/alerts', () => ({ alertsApi: api }));
const mount = () => render(<UiLanguageProvider><MemoryRouter><PriceAlertPanel symbol="AAPL" accountId={7} cost={100} currency="USD" /></MemoryRouter></UiLanguageProvider>);
describe('holding alert setup', () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.setItem('dsa.uiLanguage', 'en');
    api.status.mockResolvedValue({ enabled: false, intervalMinutes: 5, owner: 'web', channels: ['email'], configuredChannels: ['email'], worker: { running: true } });
    api.listRules.mockResolvedValue({ items: [], total: 0 }); api.listTriggers.mockResolvedValue({ items: [] }); api.listNotifications.mockResolvedValue({ items: [] }); api.createRule.mockResolvedValue({ id: 1 });
  });
  it('saves an account-bound threshold and selected channel without sending a test', async () => {
    const view = mount(); await screen.findByText('Monitor is off');
    fireEvent.change(screen.getByLabelText('Price threshold USD'), { target: { value: '90' } });
    fireEvent.click(screen.getByLabelText('Email'));
    fireEvent.click(screen.getByRole('button', { name: 'Add threshold alert' }));
    await waitFor(() => expect(api.createRule).toHaveBeenCalledWith(expect.objectContaining({
      target: 'AAPL', parameters: { direction: 'below', price: 90 }, cooldownPolicy: { cooldownSeconds: 86400 },
      notificationPolicy: { holdingAccountId: 7, channels: ['email'], report: 'price_brief', language: 'en' },
    })));
    expect(api.testRule).not.toHaveBeenCalled(); expect(view.container.textContent).not.toMatch(/[\u3400-\u9fff]/);
  });
  it('does not claim delivery is ready without channels', async () => {
    api.status.mockResolvedValue({ enabled: true, owner: 'web', channels: [], worker: { running: true } });
    mount(); expect(await screen.findByText(/No alert channels available/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Configure channels' })).toHaveAttribute('href', '/settings?tab=notifications');
  });
  it('retains the original account binding when editing a rule', async () => {
    api.listRules.mockResolvedValue({ total: 1, items: [{ id: 4, target: 'AAPL', alertType: 'price_cross', parameters: { direction: 'above', price: 150 }, enabled: true, notificationPolicy: { holdingAccountId: 12, channels: ['email'] } }] });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & enable rule' }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledWith(4, expect.objectContaining({ notificationPolicy: expect.objectContaining({ holdingAccountId: 12 }) })));
  });
  it('shows the stock and trigger identity for delivery results, including older unmatched events', async () => {
    api.listTriggers.mockResolvedValue({ items: [{ id: 10, target: 'AAPL', status: 'triggered' }] });
    api.listNotifications.mockResolvedValue({ items: [{ id: 1, triggerId: 10, channel: 'email', success: true }, { id: 2, triggerId: 3, channel: 'email', success: false }] });
    render(<UiLanguageProvider><MemoryRouter><PriceAlertPanel /></MemoryRouter></UiLanguageProvider>);
    await screen.findByText('AAPL · Trigger #10');
    expect(screen.getByText('Event outside recent records · Trigger #3')).toBeInTheDocument();
  });
});
