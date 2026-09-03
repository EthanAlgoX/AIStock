import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, Plus, RefreshCw, Save, Server, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { workspaceApi, type WorkspaceMcpServer } from "../api/workspace";
import { AppPage, PageHeader } from "../components/common";
import { CapabilityCenterNav } from "../components/capability/CapabilityCenterNav";

type McpForm = { name: string; transport: "http" | "stdio"; location: string; credentialKey: string };
const emptyForm: McpForm = { name: "", transport: "http", location: "", credentialKey: "" };

const MCP_PRESETS: Array<McpForm & { id: string; description: string; endpointHint: string }> = [
  {
    id: "regulatory-filings",
    name: "公告与监管披露",
    transport: "http",
    location: "",
    credentialKey: "REGULATORY_FILINGS_API_KEY",
    description: "查询公司公告、监管文件和定期报告，适合个股研究与专家评审。",
    endpointHint: "填写已部署的 HTTP MCP 地址",
  },
  {
    id: "market-news",
    name: "市场与财经新闻",
    transport: "http",
    location: "",
    credentialKey: "MARKET_NEWS_API_KEY",
    description: "检索市场新闻、公司事件和舆情信息，适合选股复核和交易监控。",
    endpointHint: "填写新闻检索 MCP 地址",
  },
  {
    id: "local-quant",
    name: "本地量化计算",
    transport: "stdio",
    location: "",
    credentialKey: "",
    description: "调用本地指标、因子和组合计算工具，避免让 Agent 自行完成确定性计算。",
    endpointHint: "填写本地 MCP Server 启动命令",
  },
];

export default function McpSettingsPage() {
  const [connections, setConnections] = useState<WorkspaceMcpServer[]>([]);
  const [form, setForm] = useState<McpForm>(emptyForm);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadConnections = async () => {
    setConnections(await workspaceApi.listMcpServers());
  };

  useEffect(() => {
    let active = true;
    void workspaceApi.listMcpServers()
      .then((result) => active && setConnections(result))
      .catch(() => active && setError("MCP Server 列表读取失败，请稍后重试。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.location.trim()) return;
    setError("");
    setBusyId("new");
    try {
      await workspaceApi.createMcpServer({ ...form, name: form.name.trim(), location: form.location.trim(), credentialKey: form.credentialKey.trim(), enabled: true });
      await loadConnections();
      setForm(emptyForm);
      setSaved(true);
    } catch {
      setError("MCP Server 保存失败，请检查地址、凭据键或名称是否重复。");
    } finally {
      setBusyId("");
    }
  };

  const toggleConnection = async (connection: WorkspaceMcpServer) => {
    setBusyId(connection.id);
    setError("");
    try {
      await workspaceApi.updateMcpServer(connection.id, { enabled: !connection.enabled });
      await loadConnections();
    } catch {
      setError("MCP Server 状态更新失败。");
    } finally { setBusyId(""); }
  };

  const deleteConnection = async (connection: WorkspaceMcpServer) => {
    setBusyId(connection.id);
    setError("");
    try {
      await workspaceApi.deleteMcpServer(connection.id);
      await loadConnections();
    } catch {
      setError("MCP Server 删除失败。");
    } finally { setBusyId(""); }
  };

  const probeConnection = async (connection: WorkspaceMcpServer) => {
    setBusyId(connection.id);
    setError("");
    try {
      await workspaceApi.probeMcpServer(connection.id);
      await loadConnections();
    } catch {
      setError("MCP 健康检查失败；连接已保留，可修改后重试。");
    } finally { setBusyId(""); }
  };

  return (
    <AppPage className="space-y-6 pb-20" data-testid="mcp-settings-page">
      <PageHeader
        eyebrow="Capability registry"
        title="MCP 服务"
        description="管理为 Agent 提供外部 Tool、Resource 或 Prompt 的 MCP Server。内置 Tool 在独立工具页面治理，不与连接协议混为一类。"
        actions={<Link to="/overview" className="btn-primary">返回主 Agent</Link>}
      />
      <CapabilityCenterNav />

      <section className="rounded-[14px] border border-border bg-card shadow-soft-card">
        <div className="border-b border-border/70 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">平台预置</p>
          <h2 className="mt-1 font-semibold text-foreground">金融 MCP 服务模板</h2>
          <p className="mt-1 text-xs text-muted-text">模板只预填用途、传输方式和凭据键；服务地址或启动命令仍由工作区管理员提供。</p>
        </div>
        <div className="grid divide-y divide-border/60 md:grid-cols-3 md:divide-x md:divide-y-0">
          {MCP_PRESETS.map((preset) => (
            <article key={preset.id} className="flex min-w-0 flex-col p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-border bg-background text-primary"><Server className="h-4 w-4" /></span>
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-text">{preset.transport}</span>
              </div>
              <h3 className="mt-4 font-medium text-foreground">{preset.name}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-secondary-text">{preset.description}</p>
              <p className="mt-3 text-xs text-muted-text">{preset.endpointHint}</p>
              <button type="button" onClick={() => { setForm({ name: preset.name, transport: preset.transport, location: preset.location, credentialKey: preset.credentialKey }); setSaved(false); }} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">使用模板 <ArrowRight className="h-4 w-4" /></button>
            </article>
          ))}
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-[12px] border border-warning/25 bg-warning/5 px-4 py-3 text-sm leading-6 text-secondary-text">
        <CircleAlert className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p><span className="font-medium text-warning">安全边界。</span> HTTP MCP 可由后端执行能力发现并按任务动态挂载；stdio 连接只登记配置，由隔离的 独立 Agent 引擎 启动，网站不会执行任意本地命令。凭据只引用环境变量名。</p>
      </div>

      {error ? <p role="alert" className="rounded-[12px] border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card">
          <div className="border-b border-border/70 px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">工作区连接</p><h2 className="mt-1 font-semibold text-foreground">已登记 MCP Server</h2><p className="mt-1 text-xs text-muted-text">启用只表示工作区准备使用该连接，不代表 Server 已连通或其工具已被发现。</p></div>
          {loading ? <p className="flex items-center gap-2 px-5 py-10 text-sm text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取 MCP Server…</p> : null}
          {!loading && connections.length ? <div className="divide-y divide-border/60">{connections.map((connection) => (
            <div key={connection.id} className="flex items-start gap-4 px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-background text-primary"><Server className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-foreground">{connection.name}</p><span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-text">{connection.transport}</span><span className={connection.healthStatus === "healthy" ? "text-[10px] text-success" : connection.healthStatus === "unreachable" ? "text-[10px] text-danger" : "text-[10px] text-warning"}>{connection.healthStatus}</span></div><p className="mt-1 truncate text-xs text-secondary-text">{connection.location}</p><p className="mt-1 text-[11px] text-muted-text">凭据键：{connection.credentialKey || "未设置"} · 已发现 {connection.capabilities.length} 项能力</p>{connection.lastError ? <p className="mt-1 text-[11px] text-danger">{connection.lastError}</p> : null}</div>
              <button type="button" disabled={busyId === connection.id} onClick={() => void probeConnection(connection)} className="rounded-md p-2 text-muted-text hover:bg-hover hover:text-primary disabled:opacity-40" aria-label={`检查 MCP ${connection.name}`}><RefreshCw className={`h-4 w-4 ${busyId === connection.id ? "animate-spin" : ""}`} /></button>
              <label className="flex items-center gap-2 text-xs text-secondary-text"><input type="checkbox" checked={connection.enabled} disabled={busyId === connection.id} onChange={() => void toggleConnection(connection)} />启用</label>
              <button type="button" disabled={busyId === connection.id} onClick={() => void deleteConnection(connection)} className="rounded-md p-2 text-muted-text hover:bg-danger/10 hover:text-danger disabled:opacity-40" aria-label={`删除 MCP ${connection.name}`}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}</div> : null}
          {!loading && !connections.length ? <div className="px-5 py-12 text-center"><Server className="mx-auto h-7 w-7 text-muted-text" /><p className="mt-3 font-medium text-foreground">还没有 MCP Server</p><p className="mt-1 text-sm text-secondary-text">登记后执行健康检查，发现的工具即可绑定到 Agent 任务。</p></div> : null}
        </section>

        <form onSubmit={add} className="rounded-[14px] border border-border bg-background p-5 xl:sticky xl:top-6 xl:self-start">
          <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /><h2 className="font-semibold text-foreground">配置自定义连接</h2></div>
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-foreground">名称<input aria-label="MCP 名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：公司公告检索" className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 outline-none focus:border-primary" /></label>
            <label className="block text-sm font-medium text-foreground">传输方式<select aria-label="MCP 传输方式" value={form.transport} onChange={(event) => setForm({ ...form, transport: event.target.value as "http" | "stdio" })} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 outline-none focus:border-primary"><option value="http">HTTP / Streamable HTTP</option><option value="stdio">本地 stdio</option></select></label>
            <label className="block text-sm font-medium text-foreground">{form.transport === "http" ? "服务地址" : "启动命令"}<input aria-label="MCP 连接地址" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder={form.transport === "http" ? "https://mcp.example.com" : "npx my-mcp-server"} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 font-mono text-sm outline-none focus:border-primary" /></label>
            <label className="block text-sm font-medium text-foreground">凭据配置键<input aria-label="MCP 凭据配置键" value={form.credentialKey} onChange={(event) => setForm({ ...form, credentialKey: event.target.value })} placeholder="例如：MCP_COMPANY_NEWS_TOKEN" className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 font-mono text-sm outline-none focus:border-primary" /><span className="mt-1 block text-xs text-muted-text">这里只引用配置键，不填写密钥值。</span></label>
          </div>
          <button type="submit" disabled={!form.name.trim() || !form.location.trim() || busyId === "new"} className="btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 disabled:opacity-45">{busyId === "new" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存工作区连接</button>
          {saved ? <p role="status" className="mt-3 flex items-center gap-2 text-xs text-success"><CheckCircle2 className="h-4 w-4" />连接已保存到后端工作区。</p> : null}
        </form>
      </div>
    </AppPage>
  );
}
