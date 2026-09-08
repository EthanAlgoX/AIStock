import apiClient from './index';
import type { WorkspaceTask, WorkspaceRun, WorkspaceSchedule } from './workspace';
import type { AgentCapabilityBindings } from '../types/capabilities';

export type HoldingRules = { lossPct: number; profitPct: number; dailyMovePct: number };
export type HoldingPlan = { task: WorkspaceTask; schedule: WorkspaceSchedule | null; timezone: string; runAt: string };
export type HoldingItem = {
  accountId: number; accountName: string; taskId: string | null; supported: boolean;
  position: { symbol: string; market: string; currency: string; quantity: number; avg_cost: number;
    last_price: number; unrealized_pnl_pct: number | null; price_available: boolean; price_stale: boolean;
    price_date: string | null; price_source: string; };
  alerts: string[]; schedule: WorkspaceSchedule | null;
  run: { id: string; status: string; createdAt: string; error: string | null; currentSession: boolean } | null;
  brief: { name: string | null; summary: string; action: string | null; advice: string | null;
    trend: string | null; changePct: number | null; strategy: Record<string, unknown> | null } | null;
};
export type HoldingsDashboard = { asOf: string; items: HoldingItem[]; rules: HoldingRules };
const root = '/api/v1/workspace/portfolio-research';
const positionUrl = (accountId: number, symbol: string) => `${root}/${accountId}/${encodeURIComponent(symbol)}`;
export const portfolioResearchApi = {
  async dashboard(refresh = false) { return (refresh ? await apiClient.post<HoldingsDashboard>(`${root}/refresh`) : await apiClient.get<HoldingsDashboard>(root)).data; },
  async plan(account: number, symbol: string) { return (await apiClient.get<HoldingPlan>(`${positionUrl(account, symbol)}/plan`)).data; },
  async configure(account: number, symbol: string, payload: { strategyVersionId: number; capabilities: AgentCapabilityBindings; rules: HoldingRules; dailyEnabled: boolean; runAt: string }) {
    return (await apiClient.put<HoldingPlan>(`${positionUrl(account, symbol)}/plan`, payload)).data;
  },
  async run(account: number, symbol: string) { return (await apiClient.post<WorkspaceRun>(`${positionUrl(account, symbol)}/run`)).data; },
};
