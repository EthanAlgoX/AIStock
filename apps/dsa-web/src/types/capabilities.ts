export type AgentCapabilityBindings = {
  skillIds: string[];
  toolIds: string[];
  mcpIds: string[];
  dataSourceIds: string[];
  expertIds: number[];
  expertTeamIds: number[];
};

export const EMPTY_AGENT_CAPABILITIES: AgentCapabilityBindings = {
  skillIds: [],
  toolIds: [],
  mcpIds: [],
  dataSourceIds: [],
  expertIds: [],
  expertTeamIds: [],
};

export const normalizeAgentCapabilities = (
  value?: Partial<AgentCapabilityBindings>,
): AgentCapabilityBindings => ({
  skillIds: Array.isArray(value?.skillIds) ? value.skillIds : [],
  toolIds: Array.isArray(value?.toolIds) ? value.toolIds : [],
  mcpIds: Array.isArray(value?.mcpIds) ? value.mcpIds : [],
  dataSourceIds: Array.isArray(value?.dataSourceIds) ? value.dataSourceIds : [],
  expertIds: Array.isArray(value?.expertIds) ? value.expertIds : [],
  expertTeamIds: Array.isArray(value?.expertTeamIds) ? value.expertTeamIds : [],
});

export const countAgentCapabilities = (bindings: AgentCapabilityBindings) => (
  bindings.skillIds.length
  + bindings.toolIds.length
  + bindings.mcpIds.length
  + bindings.dataSourceIds.length
  + bindings.expertIds.length
  + bindings.expertTeamIds.length
);
