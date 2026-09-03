import {
  countAgentCapabilities,
  EMPTY_AGENT_CAPABILITIES,
  type AgentCapabilityBindings,
} from "./capabilities";

export type ScheduledTaskKind = "research" | "screening" | "trading";
export type ScheduledTaskMarket = "CN" | "HK" | "US";

export type ScheduledCapabilityBindings = AgentCapabilityBindings;

export type ScheduledTaskPrefill = {
  sourceLabel: string;
  kind: ScheduledTaskKind;
  name: string;
  market: ScheduledTaskMarket;
  stock?: string;
  stockName?: string;
  objective?: string;
  industry?: string;
  candidateCount?: string;
  strategyRef?: string;
  strategyName?: string;
  scheduleMode?: "daily" | "interval";
  intervalMinutes?: string;
  capabilities: ScheduledCapabilityBindings;
};

export type ScheduledTaskNavigationState = {
  schedulePrefill?: ScheduledTaskPrefill;
};

export const EMPTY_SCHEDULED_CAPABILITIES: ScheduledCapabilityBindings = {
  ...EMPTY_AGENT_CAPABILITIES,
};

export const countScheduledCapabilities = countAgentCapabilities;
