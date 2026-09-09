export type FinanceToolCategory = "market" | "research" | "intelligence" | "screening" | "validation";

export type FinanceToolCatalogItem = {
  id: string;
  name: string;
  description: string;
  category: FinanceToolCategory;
  permission: "READ" | "COMPUTE";
  scope: "股票" | "市场" | "组合" | "策略";
};

export const FINANCE_TOOL_CATEGORY_META: Record<FinanceToolCategory, { label: string; description: string }> = {
  market: {
    label: "行情与账户",
    description: "读取价格、历史行情、市场结构和组合快照。",
  },
  research: {
    label: "量化计算",
    description: "执行技术指标、形态和量价等确定性计算。",
  },
  intelligence: {
    label: "研究情报",
    description: "检索新闻、基本面和已保存的研究上下文。",
  },
  screening: {
    label: "股票池筛选",
    description: "运行已有的确定性选股管线，生成真实候选清单。",
  },
  validation: {
    label: "策略验证",
    description: "读取 Skill、策略和个股的历史回测证据。",
  },
};

export const FINANCE_TOOL_CATALOG: FinanceToolCatalogItem[] = [
  {
    id: "build_analysis_chart",
    name: "代码计算与绘图",
    description: "用已取得的数据和四则运算表达式生成趋势图、对比图、条件关系图，保留来源、公式和数据表，可下载 SVG。",
    category: "research",
    permission: "COMPUTE",
    scope: "策略",
  },
  {
    id: "screen_stock_universe",
    name: "股票池筛选",
    description: "按市场和已注册筛选策略运行真实选股管线，返回排序后的候选股票。",
    category: "screening",
    permission: "COMPUTE",
    scope: "市场",
  },
  {
    id: "get_realtime_quote",
    name: "实时行情",
    description: "读取指定股票的最新价格、涨跌和成交信息。",
    category: "market",
    permission: "READ",
    scope: "股票",
  },
  {
    id: "get_daily_history",
    name: "历史 K 线",
    description: "读取指定股票的历史 OHLCV 数据。",
    category: "market",
    permission: "READ",
    scope: "股票",
  },
  {
    id: "get_market_indices",
    name: "市场指数",
    description: "读取主要市场指数和整体市场表现。",
    category: "market",
    permission: "READ",
    scope: "市场",
  },
  {
    id: "get_macro_indicators",
    name: "宏观指标",
    description: "按市场读取带来源和时间的宏观观测值；缺失序列不会用估算值填充。",
    category: "market",
    permission: "READ",
    scope: "市场",
  },
  {
    id: "get_sector_rankings",
    name: "行业板块排名",
    description: "读取行业和板块的相对强弱与排名。",
    category: "market",
    permission: "READ",
    scope: "市场",
  },
  {
    id: "get_capital_flow",
    name: "资金流",
    description: "读取个股或市场维度的资金流向证据。",
    category: "market",
    permission: "READ",
    scope: "股票",
  },
  {
    id: "get_chip_distribution",
    name: "筹码分布",
    description: "读取筹码结构、集中度和潜在成本区间。",
    category: "market",
    permission: "READ",
    scope: "股票",
  },
  {
    id: "get_portfolio_snapshot",
    name: "组合快照",
    description: "读取当前组合持仓和基础暴露信息。",
    category: "market",
    permission: "READ",
    scope: "组合",
  },
  {
    id: "analyze_trend",
    name: "技术趋势",
    description: "基于历史行情计算趋势状态和关键结构。",
    category: "research",
    permission: "COMPUTE",
    scope: "股票",
  },
  {
    id: "calculate_ma",
    name: "均线系统",
    description: "计算均线位置、排列和交叉关系。",
    category: "research",
    permission: "COMPUTE",
    scope: "股票",
  },
  {
    id: "get_volume_analysis",
    name: "量能分析",
    description: "计算成交量变化及量价配合关系。",
    category: "research",
    permission: "COMPUTE",
    scope: "股票",
  },
  {
    id: "analyze_pattern",
    name: "K 线形态",
    description: "识别常见价格形态和可能的失效条件。",
    category: "research",
    permission: "COMPUTE",
    scope: "股票",
  },
  {
    id: "get_stock_info",
    name: "公司基本面",
    description: "读取公司信息和关键基本面字段。",
    category: "intelligence",
    permission: "READ",
    scope: "股票",
  },
  {
    id: "search_stock_news",
    name: "股票新闻",
    description: "检索与指定股票相关的近期新闻和事件。",
    category: "intelligence",
    permission: "READ",
    scope: "股票",
  },
  {
    id: "search_comprehensive_intel",
    name: "综合情报",
    description: "组合搜索新闻、公告和多维研究信息。",
    category: "intelligence",
    permission: "READ",
    scope: "股票",
  },
  {
    id: "get_analysis_context",
    name: "历史分析上下文",
    description: "读取平台已经保存的股票分析证据。",
    category: "intelligence",
    permission: "READ",
    scope: "股票",
  },
  {
    id: "get_skill_backtest_summary",
    name: "Skill 回测摘要",
    description: "读取金融 Skill 的历史回测汇总。",
    category: "validation",
    permission: "READ",
    scope: "策略",
  },
  {
    id: "get_strategy_backtest_summary",
    name: "策略回测摘要",
    description: "读取指定策略的历史验证汇总。",
    category: "validation",
    permission: "READ",
    scope: "策略",
  },
  {
    id: "get_stock_backtest_summary",
    name: "个股回测证据",
    description: "读取指定股票相关的历史回测记录。",
    category: "validation",
    permission: "READ",
    scope: "股票",
  },
];
