import type {
  WorkspaceCapabilityCatalog,
  WorkspaceRun,
  WorkspaceSchedule,
  WorkspaceTask,
} from "./api/workspace";
import { EMPTY_AGENT_CAPABILITIES } from "./types/capabilities";

export const workspaceCatalogFixture: WorkspaceCapabilityCatalog = {
  discussionChatBinding: true,
  discussionReconfiguration: true,
  discussionModes: ["pipeline", "debate", "voting"],
  discussionProtocols: ["cross_response_v1"],
  skills: [
    { id: "quality", name: "盈利质量", description: "检查现金流", category: "research", instructions: "", version: 1, builtIn: true, enabled: true },
    { id: "trend", name: "趋势分析", description: "检查趋势", category: "trading", instructions: "", version: 1, builtIn: true, enabled: true },
  ],
  tools: [
    { id: "get_realtime_quote", name: "实时行情", description: "读取实时行情", category: "data", enabled: true },
  ],
  mcpServers: [],
  dataSources: [
    {
      sourceId: "market",
      name: "行情数据",
      kind: "kline",
      description: "日线行情",
      connectionKey: "market",
      required: true,
      builtIn: true,
      selectable: true,
      availability: "system_managed",
      selectionMode: "automatic",
      markets: ["cn", "hk", "us"],
    },
  ],
  experts: [
    { id: -1001, name: "沃伦·巴菲特", style: "长期价值", description: "企业质量", philosophy: "安全边际", focus: ["护城河"], prompt: "长期价值投资，检查护城河和安全边际。", defaultPrompt: "长期价值投资，检查护城河和安全边际。", version: 1, builtIn: true, enabled: true },
    { id: -1002, name: "查理·芒格", style: "反向审查", description: "认知与风险", philosophy: "避免愚蠢", focus: ["反向思考"], prompt: "先寻找永久损失风险。", defaultPrompt: "先寻找永久损失风险。", version: 1, builtIn: true, enabled: true },
    { id: -1003, name: "段永平", style: "商业模式", description: "能力圈", philosophy: "买股票就是买公司", focus: ["生意模式"], prompt: "判断商业模式和能力圈。", defaultPrompt: "判断商业模式和能力圈。", version: 1, builtIn: true, enabled: true },
    { id: -1004, name: "凯西·伍德", style: "创新成长", description: "技术曲线", philosophy: "五年视角", focus: ["创新"], prompt: "构建五年创新情景。", defaultPrompt: "构建五年创新情景。", version: 1, builtIn: true, enabled: true },
    { id: -1005, name: "张磊", style: "长期主义", description: "结构价值", philosophy: "价值创造", focus: ["产业结构"], prompt: "分析结构性价值。", defaultPrompt: "分析结构性价值。", version: 1, builtIn: true, enabled: true },
  ],
  expertTeams: [
    { id: -2001, name: "长期价值评审团", description: "价值评审", memberIds: [-1001, -1002, -1003], protocol: "独立分析 → 交叉质疑 → 汇总", version: 1, builtIn: true, enabled: true },
    { id: -2003, name: "全视角个股委员会", description: "全视角评审", memberIds: [-1001, -1002, -1003, -1004, -1005], protocol: "独立分析 → 交叉质疑 → 汇总", version: 1, builtIn: true, enabled: true },
  ],
  defaults: {
    chat: { skillIds: ["quality"], toolIds: ["get_realtime_quote"], mcpIds: [], dataSourceIds: ["market"], expertIds: [], expertTeamIds: [] },
    research: { skillIds: ["quality"], toolIds: ["get_realtime_quote"], mcpIds: [], dataSourceIds: ["market"], expertIds: [], expertTeamIds: [] },
    screening: { skillIds: ["quality"], toolIds: ["get_realtime_quote"], mcpIds: [], dataSourceIds: ["market"], expertIds: [], expertTeamIds: [] },
    trading: { skillIds: ["trend"], toolIds: ["get_realtime_quote"], mcpIds: [], dataSourceIds: ["market"], expertIds: [], expertTeamIds: [] },
    expert_review: { skillIds: ["quality"], toolIds: ["get_realtime_quote"], mcpIds: [], dataSourceIds: ["market"], expertIds: [], expertTeamIds: [] },
    market_analysis: { skillIds: ["quality"], toolIds: ["get_realtime_quote"], mcpIds: [], dataSourceIds: ["market"], expertIds: [], expertTeamIds: [] },
    industry_analysis: { skillIds: ["quality"], toolIds: ["get_realtime_quote"], mcpIds: [], dataSourceIds: ["market"], expertIds: [], expertTeamIds: [] },
  },
};

export const workspaceTaskFixture = (overrides: Partial<WorkspaceTask> = {}): WorkspaceTask => ({
  id: "task-1",
  kind: "screening",
  name: "测试任务",
  market: "CN",
  objective: "完成测试",
  subject: {},
  config: {},
  capabilities: { ...EMPTY_AGENT_CAPABILITIES },
  version: 1,
  enabled: true,
  createdAt: "2026-09-02T01:00:00Z",
  updatedAt: "2026-09-02T01:00:00Z",
  ...overrides,
});

export const workspaceRunFixture = (task: WorkspaceTask, overrides: Partial<WorkspaceRun> = {}): WorkspaceRun => ({
  id: "run-1",
  taskId: task.id,
  kind: task.kind,
  status: "completed",
  triggerType: "manual",
  dataSnapshotId: "snapshot-1",
  taskSnapshot: task,
  resultSummary: { artifactTypes: ["ResearchReport"] },
  createdAt: "2026-09-02T01:00:00Z",
  updatedAt: "2026-09-02T01:01:00Z",
  completedAt: "2026-09-02T01:01:00Z",
  artifacts: [],
  ...overrides,
});

export const workspaceScheduleFixture = (overrides: Partial<WorkspaceSchedule> = {}): WorkspaceSchedule => ({
  id: "schedule-1",
  taskId: "task-1",
  name: "每日测试",
  scheduleMode: "daily",
  runAt: "18:30",
  timezone: "Asia/Shanghai",
  enabled: true,
  nextRunAt: "2026-09-03T10:30:00Z",
  createdAt: "2026-09-02T01:00:00Z",
  updatedAt: "2026-09-02T01:00:00Z",
  ...overrides,
});
