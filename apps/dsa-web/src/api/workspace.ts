import apiClient from "./index";
import type { AgentCapabilityBindings } from "../types/capabilities";

export type WorkspaceSkill = { id: string; name: string; description: string; category: string; instructions: string; version: number; builtIn: boolean; enabled: boolean };
export type WorkspaceTool = { id: string; name: string; description: string; category: string; enabled: boolean; policy?: Record<string, unknown> };
export type WorkspaceMcpServer = { id: string; name: string; transport: "http" | "stdio"; location: string; credentialKey: string; enabled: boolean; selectable: boolean; healthStatus: string; lastCheckedAt?: string | null; lastError?: string | null; capabilities: Array<{type:string;name:string;description?:string;inputSchema?:Record<string,unknown>}> };
export type WorkspaceDataSourceMember = { id:string; name:string; domain:string; category:"publisher"|"corporate_wire"|"regulator"; markets:string[] };
export type WorkspaceDataSource = { id?:number; sourceId:string; name:string; kind:"kline"|"news"|"fundamentals"|"other"; description?:string|null; connectionKey:string; required:boolean; builtIn:boolean; selectable:boolean; availability:"system_managed"|"configured"|"unconfigured"|"registered"; selectionMode?:"automatic"|"provider"|"local"; providerName?:string; includedSources?:WorkspaceDataSourceMember[]; markets?:string[]; createdAt?:string; updatedAt?:string };
export type WorkspaceExpert = { id: number; name: string; style: string; description: string; philosophy: string; focus: string[]; prompt: string; defaultPrompt: string; version: number; builtIn: boolean; enabled: boolean };
export type WorkspaceExpertTeam = { id: number; name: string; description: string; memberIds: number[]; protocol: string; version: number; builtIn: boolean; enabled: boolean };
export type WorkspaceCapabilityCatalog = { skills: WorkspaceSkill[]; tools: WorkspaceTool[]; mcpServers: WorkspaceMcpServer[]; dataSources: WorkspaceDataSource[]; experts: WorkspaceExpert[]; expertTeams: WorkspaceExpertTeam[]; defaults: Record<"chat"|WorkspaceTaskKind, AgentCapabilityBindings> };
export type WorkspaceTaskKind = "research" | "screening" | "trading" | "expert_review";
export type WorkspaceTask = { id:string; kind:WorkspaceTaskKind; name:string; market:"CN"|"HK"|"US"|"GLOBAL"; objective:string; subject:Record<string,unknown>; config:Record<string,unknown>; capabilities:AgentCapabilityBindings; version:number; enabled:boolean; createdAt:string; updatedAt:string };
export type WorkspaceArtifact = { id:string; type:string; title:string; content:unknown; text?:string|null; version:number; createdAt:string };
export type WorkspaceRun = { id:string; taskId:string; kind:WorkspaceTaskKind; status:"queued"|"running"|"completed"|"failed"|"cancelled"; triggerType:string; dataSnapshotId:string; taskSnapshot:WorkspaceTask; resultSummary?:Record<string,unknown>|null; errorCode?:string|null; errorMessage?:string|null; startedAt?:string|null; completedAt?:string|null; createdAt:string; updatedAt:string; artifacts:WorkspaceArtifact[]; dataSnapshot?:{id:string;asOf:string;sourceIds:string[];sourceVersions:Record<string,unknown>;quality:Record<string,unknown>}|null };
export type WorkspaceSchedule = { id:string; taskId:string; name:string; scheduleMode:"daily"|"interval"; runAt?:string|null; intervalMinutes?:number|null; timezone:string; enabled:boolean; nextRunAt:string; lastRunAt?:string|null; lastRunId?:string|null; createdAt:string; updatedAt:string };

const root = "/api/v1/workspace";

export const workspaceApi = {
  async getCapabilities() { const { data } = await apiClient.get<WorkspaceCapabilityCatalog>(`${root}/capabilities`); return data; },
  async listSkills() { const { data } = await apiClient.get<WorkspaceSkill[]>(`${root}/skills`); return data; },
  async createSkill(payload: Omit<WorkspaceSkill,"version"|"builtIn">) { const { data } = await apiClient.post<WorkspaceSkill>(`${root}/skills`, payload); return data; },
  async updateSkill(id:string,payload:Partial<WorkspaceSkill>) { const { data } = await apiClient.patch<WorkspaceSkill>(`${root}/skills/${id}`,payload); return data; },
  async deleteSkill(id:string) { await apiClient.delete(`${root}/skills/${id}`); },
  async listTools() { const { data } = await apiClient.get<WorkspaceTool[]>(`${root}/tools`); return data; },
  async listDataSources() { const { data } = await apiClient.get<WorkspaceDataSource[]>(`${root}/data-sources`); return data; },
  async createDataSource(payload:{name:string;description?:string;connectionKey:string;kind:WorkspaceDataSource["kind"];markets:string[]}) { const { data } = await apiClient.post<WorkspaceDataSource>(`${root}/data-sources`,payload); return data; },
  async archiveDataSource(id:number) { const { data } = await apiClient.delete<WorkspaceDataSource & {archived:boolean}>(`${root}/data-sources/${id}`); return data; },
  async setPreferences(kind:string,enabledIds:Array<string|number>) { const { data } = await apiClient.put(`${root}/capabilities/${kind}/preferences`,{enabledIds}); return data; },
  async listMcpServers() { const { data } = await apiClient.get<WorkspaceMcpServer[]>(`${root}/mcp-servers`); return data; },
  async createMcpServer(payload:{name:string;transport:"http"|"stdio";location:string;credentialKey:string;enabled?:boolean}) { const { data } = await apiClient.post<WorkspaceMcpServer>(`${root}/mcp-servers`,payload); return data; },
  async updateMcpServer(id:string,payload:Partial<WorkspaceMcpServer>) { const { data } = await apiClient.patch<WorkspaceMcpServer>(`${root}/mcp-servers/${id}`,payload); return data; },
  async deleteMcpServer(id:string) { await apiClient.delete(`${root}/mcp-servers/${id}`); },
  async probeMcpServer(id:string) { const { data } = await apiClient.post<WorkspaceMcpServer>(`${root}/mcp-servers/${id}/probe`); return data; },
  async listExperts() { const { data } = await apiClient.get<WorkspaceExpert[]>(`${root}/experts`); return data; },
  async createExpert(payload:{name:string;style:string;description?:string;philosophy?:string;focus?:string[];prompt:string}) { const { data } = await apiClient.post<WorkspaceExpert>(`${root}/experts`,payload); return data; },
  async updateExpert(id:number,payload:Partial<WorkspaceExpert>) { const { data } = await apiClient.patch<WorkspaceExpert>(`${root}/experts/${id}`,payload); return data; },
  async deleteExpert(id:number) { await apiClient.delete(`${root}/experts/${id}`); },
  async listExpertTeams() { const { data } = await apiClient.get<WorkspaceExpertTeam[]>(`${root}/expert-teams`); return data; },
  async createExpertTeam(payload:{name:string;description?:string;memberIds:number[];protocol:string}) { const { data } = await apiClient.post<WorkspaceExpertTeam>(`${root}/expert-teams`,payload); return data; },
  async updateExpertTeam(id:number,payload:Partial<WorkspaceExpertTeam>) { const { data } = await apiClient.patch<WorkspaceExpertTeam>(`${root}/expert-teams/${id}`,payload); return data; },
  async deleteExpertTeam(id:number) { await apiClient.delete(`${root}/expert-teams/${id}`); },
  async createTask(payload:{kind:WorkspaceTaskKind;name:string;market:WorkspaceTask["market"];objective:string;subject?:Record<string,unknown>;config?:Record<string,unknown>;capabilities:AgentCapabilityBindings;enabled?:boolean}) { const { data } = await apiClient.post<WorkspaceTask>(`${root}/tasks`,payload); return data; },
  async updateTask(id:string,payload:Partial<WorkspaceTask>) { const { data } = await apiClient.patch<WorkspaceTask>(`${root}/tasks/${id}`,payload); return data; },
  async listTasks(kind?:WorkspaceTaskKind) { const { data } = await apiClient.get<WorkspaceTask[]>(`${root}/tasks`,{params:{kind}}); return data; },
  async deleteTask(id:string) { await apiClient.delete(`${root}/tasks/${id}`); },
  async runTask(id:string) { const { data } = await apiClient.post<WorkspaceRun>(`${root}/tasks/${id}/runs`,{triggerType:"manual"}); return data; },
  async listRuns(kind?:WorkspaceTaskKind) { const { data } = await apiClient.get<WorkspaceRun[]>(`${root}/runs`,{params:{kind}}); return data; },
  async getRun(id:string) { const { data } = await apiClient.get<WorkspaceRun>(`${root}/runs/${id}`); return data; },
  async cancelRun(id:string) { const { data } = await apiClient.post(`${root}/runs/${id}/cancel`); return data; },
  async createSchedule(payload:{taskId:string;name:string;scheduleMode:"daily"|"interval";runAt?:string;intervalMinutes?:number;timezone:string;enabled?:boolean}) { const { data } = await apiClient.post<WorkspaceSchedule>(`${root}/schedules`,payload); return data; },
  async listSchedules() { const { data } = await apiClient.get<WorkspaceSchedule[]>(`${root}/schedules`); return data; },
  async updateSchedule(id:string,payload:Partial<WorkspaceSchedule>) { const { data } = await apiClient.patch<WorkspaceSchedule>(`${root}/schedules/${id}`,payload); return data; },
  async deleteSchedule(id:string) { await apiClient.delete(`${root}/schedules/${id}`); },
};
