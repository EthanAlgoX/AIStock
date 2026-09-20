import client from './index';
export type StrategyKind = 'research' | 'screening' | 'trading';
export type StrategyDraftState = {
  sessionId: string; kind: StrategyKind; revision: number; validated: boolean;
  publishedStrategyId?: number | null;
  skillId: string | null; error: string | null;
  draft: Partial<Record<'name' | 'objective' | 'scope' | 'method' | 'risk' | 'data' | 'execution', string>> & { missing?: string[] };
};
const url = (id: string) => `/api/v1/workspace/strategy-drafts/${encodeURIComponent(id)}`;
export const strategyDraftsApi = {
  async sync(id: string): Promise<StrategyDraftState | null> { return (await client.post(`${url(id)}/sync`)).data; },
  async get(id: string): Promise<StrategyDraftState | null> { return (await client.get(url(id))).data; },
  async begin(id: string, kind: StrategyKind): Promise<StrategyDraftState> { return (await client.post(url(id), { kind })).data; },
  async validate(id: string, revision: number): Promise<StrategyDraftState> { return (await client.post(`${url(id)}/validate`, { revision })).data; },
  async save(id: string, revision: number): Promise<StrategyDraftState> { return (await client.post(`${url(id)}/save`, { revision })).data; },
};
