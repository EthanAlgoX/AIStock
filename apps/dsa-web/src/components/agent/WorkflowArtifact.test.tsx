import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WorkflowArtifact from "./WorkflowArtifact";

describe("WorkflowArtifact", () => {
  it("uses the memo only when requested and preserves snake-case report evidence", () => {
    render(<WorkflowArtifact researchPresentation="memo" artifact={{ title: "正式报告", type: "ResearchReport", content: {
      status: "success", workflowVersionId: 3, result: { report: {
        meta: { query_id: "q", stock_code: "600519", stock_name: "贵州茅台", report_type: "full" },
        summary: { analysis_summary: "历史正文", operation_advice: "回避", sentiment_score: 0 },
        details: { technical_analysis: "技术正文保持完整", raw_result: { dashboard: {
          core_conclusion: { one_sentence: "回避并观察" },
          signal_attribution: { strongest_bullish_signal: "估值支撑", strongest_bearish_signal: "盈利下降" },
        } } },
      } },
    } }} />);
    expect(screen.getByRole("article", { name: "投研备忘录" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "回避并观察" })).toBeVisible();
    expect(screen.getByText("技术正文保持完整")).toBeVisible();
    expect(screen.getByText("估值支撑")).toBeVisible();
    expect(screen.getByText("盈利下降")).toBeVisible();
    expect(screen.getByRole("heading", { name: /^正向信号与催化/ })).toBeVisible();
    expect(screen.queryByText("支持判断的线索")).not.toBeInTheDocument();
  });
  it("shows screening evidence, factor scores and portfolio caveats without inventing missing facts", () => {
    render(<WorkflowArtifact artifact={{ title: "选股", type: "CandidateList", content: {
      status: "success", result: { ranking_mode: "factor", degradation: ["智能重排未完成"],
        llm_portfolio_risk: "行业集中度较高", candidates: [{ code: "000001", name: "平安银行", score: 80,
          factor_scores: { value: 0, stability: 82.13 }, llm_thesis: "估值与流动性匹配",
          llm_catalysts: ["关注财报"], llm_watch_items: ["观察成交持续性"], risk_flags: ["波动风险"],
        }],
      },
    } }} />);
    expect(screen.getByText("行业集中度较高")).toBeVisible();
    fireEvent.click(screen.getByText("平安银行 · 研究依据与因子明细"));
    expect(screen.getByRole("meter", { name: "估值评分" })).toHaveAttribute("value", "0");
    expect(screen.queryByRole("meter", { name: "流动性评分" })).not.toBeInTheDocument();
    expect(within(screen.getByText("平安银行 · 研究依据与因子明细").closest("details")!).getByText("估值与流动性匹配")).toBeVisible();
    expect(screen.getByText("关注财报")).toBeVisible();
    expect(screen.getByText("智能重排未完成")).toBeVisible();
  });
  it("deduplicates screening diagnostics and hides empty portfolio sections", () => {
    const warning = "LLM ranking failed: fell back to screen_score";
    render(<WorkflowArtifact artifact={{ title: "选股", type: "CandidateList", content: {
      status: "success", warnings: [warning], result: { candidates: [], warnings: [warning], degradation: [warning], portfolio_concentration_notes: [] },
    } }} />);
    expect(screen.getAllByText("智能重排未完成，当前候选使用确定性因子排序。")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "组合风险与集中度" })).not.toBeInTheDocument();
  });
  it("keeps interpretation secondary to the formal report", () => {
    const { container } = render(<WorkflowArtifact artifact={{ title: "补充", type: "ResearchInterpretation", content: { conclusion: "附属解释" } }} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Agent 补充解读与待核实条件")).toBeVisible();
  });

  it("renders failed screening as a clear failure report rather than JSON or empty success", () => {
    render(<WorkflowArtifact artifact={{ title: "美股选股", type: "CandidateList", content: {
      status: "FAILED_NO_CANDIDATES", failure_reason: "当前没有美股策略", candidates: [],
    } }} />);
    expect(screen.getByRole("heading", { name: "未生成选股报告" })).toBeVisible();
    expect(screen.getByText("当前没有美股策略")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("本次没有符合策略条件的候选股票。")).not.toBeInTheDocument();
  });

  it("presents recovered trade fields as proposal evidence, not verified account risk", () => {
    render(<WorkflowArtifact artifact={{ title: "交易研究", type: "TradeProposal", content: {
      strategy: "趋势追踪", actions: [{ symbol: "000333", side: "BUY", shares: 1700, reference_price: 87.57, thesis: "多头排列", technical_evidence: { score: 80 } }],
      agentRiskDiscussion: { approved: true, evidence_gaps: ["资金流超时"] },
    } }} />);
    expect(screen.getByRole("heading", { name: "趋势追踪" })).toBeVisible();
    expect(screen.getByText("数量").nextElementSibling).toHaveTextContent("1700");
    expect(screen.getByText("资金流超时")).toBeVisible();
    expect(screen.getByText(/未由账户风控引擎核验/)).toBeVisible();
  });
  it("renders actual candidates and preserves zero scores and warnings", () => {
    render(<WorkflowArtifact artifact={{ title: "候选", type: "CandidateList", content: {
      status: "success", workflowVersionId: 12, warnings: ["新闻不可用"],
      result: { candidates: [{ code: "600519", name: "贵州茅台", score: 0, reason: "通过硬筛" }] },
    } }} />);
    expect(screen.getByRole("table")).toHaveTextContent("600519");
    expect(screen.getByRole("cell", { name: "0" })).toBeInTheDocument();
    expect(screen.getByText("数据与运行提示：新闻不可用")).toBeInTheDocument();
  });

  it("does not present a failed workflow as successful candidates", () => {
    render(<WorkflowArtifact artifact={{ title: "失败", type: "CandidateList", content: {
      status: "failed", result: { candidates: [{ code: "600519" }] }, message: "行情缺失",
    } }} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("行情缺失")).toBeVisible();
  });

  it("renders Markdown and structured research as a readable report with real metrics", () => {
    render(<WorkflowArtifact artifact={{ title: "研究报告", type: "ResearchReport", content: {}, text: '## 研究摘要\n\n[运行来源](/runs/example)\n\n```json\n{"stock":{"name":"平安银行","price":11.89},"conclusion":{"summary":"需继续观察","strategyScore":{"adjustedScore":0}},"businessQuality":{"facts":["现金流待核验"]}}\n```' }} />);
    expect(screen.getByRole("meter", { name: "策略评分" })).toHaveAttribute("value", "0");
    expect(screen.getByText("11.89")).toBeInTheDocument();
    expect(screen.getByText("商业质量")).toBeInTheDocument();
    expect(screen.queryByText(/"adjustedScore"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("分析过程与来源说明"));
    expect(screen.getByRole("heading", { name: "研究摘要" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "运行来源" })).toHaveAttribute("href", "/runs/example");
  });

  it("keeps malformed structured content in a disclosure instead of inventing metrics", () => {
    const { container } = render(<WorkflowArtifact artifact={{ title: "旧报告", type: "ResearchReport", content: {}, text: '```json\n{broken}\n```' }} />);
    expect(screen.getByText("展开未能结构化的原始片段")).toBeInTheDocument();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("distinguishes configuration checks from evaluated trading risk and preserves zero fills", () => {
    const { container } = render(<><WorkflowArtifact artifact={{ title: "风险", type: "RiskAssessment", content: { contractPassed: true, proposalRiskEvaluated: false } }} /><WorkflowArtifact artifact={{ title: "执行", type: "PaperTradingRun", content: { realOrdersCreated: 0, simulatedFillsCreated: 0, executionEnabled: false } }} /></>);
    expect(screen.getByText(/尚未确认完成提案风险评估/)).toBeVisible();
    expect(screen.getByText("已评估提案风险").nextElementSibling).toHaveTextContent("否");
    expect(screen.getByText("已生成模拟成交数").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText("已创建真实订单数").nextElementSibling).toHaveTextContent("0");
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("renders independent proposal plans, not executed orders", () => {
    render(<WorkflowArtifact artifact={{ title: "提案", type: "TradeProposal", content: { actions: [{ symbol: "600519", side: "hold", quantity: 0, reason: "等待证据" }] } }} />);
    expect(screen.getByText("Agent 生成的模拟提案，不是已执行订单。")).toBeVisible();
    expect(screen.getByRole("heading", { name: "600519" })).toBeVisible();
    expect(screen.getByText("等待证据")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("数量").nextElementSibling).toHaveTextContent("0");
  });
});
