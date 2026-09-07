import { useEffect, useRef, useState } from "react";
import { Play, RefreshCw } from "lucide-react";
import { workspaceApi, type DefaultTaskPlan, type WorkspaceRun } from "../../api/workspace";
import { useWorkspaceRun } from "../../hooks/useWorkspaceRun";

export default function DefaultTaskLauncher({ kind, market = "CN", stock, onRunStarted }: {
  kind: "research" | "screening" | "trading";
  market?: string;
  stock?: string;
  onRunStarted?: (run: WorkspaceRun) => void;
}) {
  const key = JSON.stringify([kind, market, stock]);
  const [result, setResult] = useState<{ key: string; plan?: DefaultTaskPlan; error?: string }>();
  const [retry, setRetry] = useState(0);
  const { busy, startRun } = useWorkspaceRun(kind, false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    void workspaceApi.getDefaultTaskPlan(kind, market, stock).then((plan) => {
      if (current) setResult({ key, plan });
    }).catch((error: { response?: { data?: { detail?: { message?: string } } } }) => {
      if (current) setResult({ key, error: error.response?.data?.detail?.message || "默认方案读取失败，请重试或手动配置。" });
    });
    return () => { current = false; };
  }, [kind, market, stock, key, retry]);
  const plan = result?.key === key ? result.plan : undefined;
  const error = result?.key === key ? result.error : undefined;
  const run = async () => {
    if (!plan || busy) return;
    await startRun(async () => {
      const task = await workspaceApi.createTask(plan.task);
      const started = await workspaceApi.runTask(task.id);
      if (mounted.current) onRunStarted?.(started);
      return started;
    }, "默认方案启动未确认，请查看运行记录与 Agent 状态。");
  };
  return <section aria-label="一键默认方案" className="rounded-xl border border-border bg-card px-4 py-4 md:px-5">
    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-foreground">{stock ? "为当前股票匹配的默认方案" : "无需填写，直接试用"}</h2>
        <p className="mt-1 text-sm leading-6 text-secondary-text">{plan ? `${String(plan.task.subject.stockName || plan.task.subject.stock || plan.task.market)} · ${plan.strategyName} · ${plan.teamName}` : error || "正在匹配策略与可用能力…"}</p>
      </div>
      <button type="button" disabled={!plan || busy} onClick={() => void run()} className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"><Play className="h-4 w-4" />运行默认方案</button>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-warning">{error}<button type="button" aria-label="重试默认方案" className="ml-2 inline-flex items-center gap-1 text-primary" onClick={() => { setResult(undefined); setRetry((value) => value + 1); }}><RefreshCw className="h-3.5 w-3.5" />重试</button></p>}
    {plan && <>
      <p className="mt-2 text-xs leading-5 text-secondary-text">本次按此方案新建运行，不覆盖你的手动配置。{kind === "trading" ? "仅生成模拟提案，不会自动下单。" : "使用真实数据与模型，可能产生调用费用。"}</p>
      <details className="mt-2 text-sm text-secondary-text"><summary className="w-fit cursor-pointer text-primary">查看选择依据、Skill 与调用成本</summary>
        <p className="mt-3">Skill：{plan.skillNames.join("、") || "正式策略综合分析方法"}；专家：{plan.expertCount} 位。</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">{plan.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        {plan.warnings.map((warning) => <p key={warning} className="mt-2 text-warning">{warning}</p>)}
        <p className="mt-3 text-xs leading-5">{plan.notice}</p>
      </details>
    </>}
  </section>;
}
