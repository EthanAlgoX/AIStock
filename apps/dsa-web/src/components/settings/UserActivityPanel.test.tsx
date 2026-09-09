// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import api from '../../api';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { UserActivityPanel } from './UserActivityPanel';
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
afterEach(cleanup);
it('shows owner and member totals and follows a call trace to its answer', async () => {
  localStorage.setItem('dsa.uiLanguage', 'en');
  vi.mocked(api.get).mockImplementation(async (url) => ({data: String(url).endsWith('/analytics') ? {
    daily: [{userId:'owner',email:'owner@example.com',date:'2026-09-10',calls:1,charged:123,confirmed:123,estimated:0}],usage:[],activity:[],
  } : String(url).endsWith('/calls') ? {total:1,items:[{id:'c',userId:'owner',requestId:'trace-a',date:'2026-09-10',feature:'trading',charged:123,estimated:false,promptTokens:100,completionTokens:23}]} : {total:1,items:[{id:'a',userId:'owner',requestId:'trace-a',feature:'trading',event:'answer',status:'completed',content:'A saved answer',createdAt:'2026-09-10T00:00:00Z'}]}}));
  render(<UiLanguageProvider><UserActivityPanel users={[{userId:'u',email:'guest@example.com'}]} /></UiLanguageProvider>);
  expect(await screen.findAllByText('123')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('User'), {target:{value:'owner'}});
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/trial/admin/analytics', expect.objectContaining({params: expect.objectContaining({user_id:'owner'})})));
  fireEvent.click(screen.getByRole('button', {name:'Model calls'}));
  fireEvent.click(await screen.findByRole('button', {name:'View related questions and activity'}));
  expect(screen.getByLabelText('Filter details by trace ID (optional)')).toHaveProperty('value','trace-a');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/trial/admin/activity', expect.objectContaining({params: expect.objectContaining({request_id:'trace-a'})})));
  expect(await screen.findByText('A saved answer')).toBeTruthy();
});
