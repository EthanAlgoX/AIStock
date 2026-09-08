import api from './index';

export type TrialKind = 'assistant' | 'roundtable' | 'research' | 'screening' | 'trading' | 'holdings';
export type TrialStatus = { enabled: boolean; user: null | { email: string; limit: number; used: number; remaining: number; activeRun: string | null }; experts: string[] };
export type TrialRun = { id: string; status: string; topic: string; events: { role: string; content: string }[]; error: string | null; createdAt: string };
export type TrialUser = { id: string; email: string; enabled: boolean; enrolled: boolean; used: number; limit: number };
const root = '/api/v1/trial';
export const trialApi = {
  async status() { return (await api.get<TrialStatus>(root + '/status')).data; },
  async runs() { return (await api.get<TrialRun[]>(root + '/runs')).data; },
  async authenticate(enroll: boolean, email: string, password: string, inviteCode: string) { await api.post(root + (enroll ? '/enroll' : '/login'), { email, password, inviteCode }); },
  async logout() { await api.post(root + '/logout'); },
  async run(body: { requestId: string; kind: TrialKind; topic: string; stock: string; language: 'en' | 'zh'; experts: string[]; mode: 'independent' | 'debate' }) { return (await api.post<{ id: string }>(root + '/runs', body)).data; },
  async users() { return (await api.get<TrialUser[]>(root + '/admin/users')).data; },
  async invite(email: string) { return (await api.post<{ email: string; inviteCode: string; limit: number }>(root + '/admin/invitations', { email })).data; },
  async enable(id: string, enabled: boolean) { await api.patch(root + '/admin/users/' + id, { enabled }); },
};
