# 持仓管理 / Portfolio research

录入股票时，先将列表标准代码（如 `600519.SH`、`00700.HK`、`AAPL.US`）转换为持仓代码，再检查所选市场；可匹配列表中的中英文名称。股票索引未加载时仍可直接输入代码，但名称匹配需要索引数据。

Holding entry normalizes exchange-qualified index codes (such as `600519.SH`, `00700.HK`, and `AAPL.US`) before validating the selected market. Exact Chinese and English names can be resolved from the stock index. Direct code entry works without the index; name resolution requires it.

## 定位与入口

`/portfolio` 是以持仓短简报为主的研究页面；桌面页头提供持仓入口，移动端在菜单中进入。`/portfolio/ledger` 维护账户与买卖记录。它复用现有持仓账本、正式单股研究内核、Agent 解读、专家评审以及工作区定时调度，不建立平行的分析或下单系统。

录入股票、股数和每股成本即可开始。首次可把当前余额作为一笔初始买入，后续按实际买卖追加流水；不要重复录入余额。多账户独立记账，同名股票不跨市场匹配。当前便捷录入支持 A 股、港股、美股；已有其他市场的账本可以显示，但自动研究暂不支持。三星韩股等不能当成 A 股代码进行研究。

初始余额录入不是完整历史重建，不足以计算历史收益率或可用现金。本页不据此建议可执行买入数量。账户资金流水、费用、分红等继续沿用既有 Portfolio API；便捷表单不替代完整券商对账。

## 简报与个性化

页面沿用现有中性色与钴蓝操作色，以分隔线组织逐条持仓简报；顶部概览只列持仓数、风险复核数和每日计划数。支持按股票或账户搜索，以及按市场或“需要复核”筛选。桌面并列展示持仓信息、风险与简报、研究操作；移动端先读风险与观点，成本和价格明细在下方折叠展开。“每日跟踪与策略”在对应持仓下方直接展开配置，不离开简报页。

- 普通个股研究提交时自动匹配持仓；底层 AnalysisService 也在未显式传入持仓时查询账本。多账户分别保留数量、币种和成本，不合成一个平均成本。
- 工作区研究在运行快照中保存当次持仓上下文，正式内核与 Agent/专家共享同一背景；后续持仓变动不改写旧报告。
- 持仓页优先摘取 Agent 解读或专家评审的结构化纯文本结论，否则使用正式研究摘要；正文最多 400 字符，超长以省略号标记，不展示原始 JSON 或对象，也不另行调用 LLM。采用最终解读时，不混入另一来源的流程建议。简报、生成时间和交易时段状态始终对应同一次最新运行，不把旧成功报告配上新运行时间。完整研究及专家报告在个股研究页展开。
- 成本、参考价格和行情日期分别列示。运行属于最近交易时段，不代表所有数据都实时；历史研究或行情缺失、过期的提示置于模型观点之前，提醒更新或仅供复核。每只股票的数值按其币种展示，不直接相加。
- 默认按市场与标的匹配已发布研究策略，无额外专家，避免每日多轮讨论的额外成本。可在“每日跟踪与策略”选择正式研究策略、自选 Skill（综合策略支持）、最多三位补充专家。正式版本已固定 Skill 时不叠加另一套方法。沿用既有工具、数据源白名单。

持仓可能进入用户配置的模型服务。当前持仓库沿用本安装的共享账户语义，不是新增的多租户隔离机制；不要把此安装公开给不受信用户。

## 风险提醒

成本亏损 10%、成本盈利 20%、日涨跌幅 5% 是可调整的**复核触发器**，不是收益承诺或自动买卖规则。代码负责阈值判断；个股研究负责趋势、量价、基本面、新闻、风险和失效条件的证据解释。

上涨提示检查止盈/追高风险，下跌提示优先核查减仓条件；不直接等同于“立即卖出/平仓”。价格缺失或过期时仅显示行情待更新，不输出价格阈值结论。日涨跌幅来自最近研究的行情；旧研究不用于今天的异动提醒。未触发阈值不代表无风险。

本期提醒保留在网页简报和研究历史中，不新增短信、邮件、即时推送或券商执行。每天检查无法替代盘中实时止损，隔夜跳空、停牌、数据延迟与流动性风险仍存在。

## 每日后台运行

用户可以手动逐只/批量研究，也可以显式开启各持仓的每日研究。默认自动跟踪关闭，避免不知情的持续模型费用。默认运行时间：A 股 16:30（Asia/Shanghai）、港股 17:30（Asia/Hong_Kong）、美股 17:00（America/New_York，随夏令时变化），可修改时间。

计划复用 WorkspaceSchedule 持久化，服务需保持运行。切换页面不停止后台任务，重新进入从服务端恢复状态；页面活动运行每 5 秒、其他状态每 30 秒重新读取。相同持仓的运行中请求去重；定时请求已存在相同有效交易日的完成研究时复用，不在周末反复调用模型。交易日历不可用时沿用平台自然日回退，不承诺严格的假日去重。失败研究可重试。

每次执行重新读取实际持仓；清仓后定时计划在下次触发时暂停。手动研究可以重新生成，历史报告不删除。服务重启后执行中任务按现有机制标为中断；不是跨进程自动续跑。调度采用本地单服务运行模型，不新增分布式锁或多 worker 恰好一次保证。

## API 与兼容

新增 `/api/v1/workspace/portfolio-research`：

- `GET /`：读取账本/缓存及短简报，不调用模型或实时行情。
- `POST /refresh`：显式刷新持仓行情，不调用模型。
- `GET /{account_id}/{symbol}/plan`：读取/准备默认研究配置，不启动研究。
- `PUT /{account_id}/{symbol}/plan`：保存 `strategyVersionId`、`capabilities`、`rules`、`dailyEnabled`、`runAt`。时区由市场决定，阈值校验为 0.1–100，时间为 HH:MM。
- `POST /{account_id}/{symbol}/run`：返回现有 WorkspaceRun，状态和成果按现有工作区契约读取。

任务类型仍为 `research`，`config.portfolioHolding` 绑定账户/股票，`config.portfolioRules` 保存阈值；未配置的旧任务不受定时去重限制。单股研究上下文增加可选 `positions`，旧的单账户字段保留。启动策略目录时增加同内核的港股/美股正式配置，不创建新的交易能力。无新增环境变量或数据库列。

部署需构建 Web 并重启后端。回滚前先停用持仓研究计划，再回滚本次代码；账本、研究历史、已创建策略和任务可保留，不需要删除数据库。旧版本不知道持仓计划的清仓保护，因此必须先暂停这些计划。

## English

The Portfolio page (`/portfolio`) shows concise, evidence-linked holding briefs. `/portfolio/ledger` records opening balances and subsequent buys/sells; these are bookkeeping events, not broker orders. Do not repeatedly enter the current balance. Incomplete opening records cannot establish historical performance or available cash.

The page uses the existing neutral surfaces and cobalt actions, with divided holding rows and a compact overview of holding, risk-review and daily-plan counts. Search by stock or account, or filter by market or review status. Desktop rows place holding facts, risk commentary and research actions side by side. On mobile, cost and price details collapse below the risk commentary. Daily-plan and strategy settings expand inline below their holding. Historical-research or unverified-price warnings precede model advice; a latest-session run does not guarantee live evidence.

Research reuses the published stock-research kernel and Agent interpretation. Matching holdings are supplied automatically, with separate account cost bases and currencies. A run freezes its holding context; later trades do not rewrite old reports. Briefs prefer plain-text conclusions from Agent interpretation or expert review, falling back to the formal research summary without another model call. Text is limited to 400 characters with an ellipsis for truncation; raw JSON and objects are excluded. Final interpretations do not mix in pipeline recommendations from another source. The brief, generation time and session status all belong to the same latest run, never an old successful report under a new timestamp. Full reports and expert opinions remain available in Stock research.

China A, Hong Kong and US stocks have research configurations. Other stored markets remain visible but do not support automated research. Default research adds no experts; users may select a published strategy, optional Skills where the strategy permits them, and up to three additional experts. Tool and data-source permissions remain unchanged. Holdings can be sent to the configured model provider; this installation retains the existing shared-account model, not new multi-tenant isolation.

Cost-loss (10%), cost-gain (20%) and daily-move (5%) thresholds are configurable review triggers, never trade instructions. Research supplies broader evidence and invalidation conditions. Stale/missing prices cannot trigger price-based conclusions. No threshold breach does not mean no risk. Alerts appear on the page and in stored research, not new outbound notifications. Daily checks cannot replace intraday risk controls.

Daily tracking is explicitly enabled per holding and is off initially to avoid surprise model costs. Default market-local times are 16:30 Asia/Shanghai, 17:30 Asia/Hong_Kong, and 17:00 America/New_York (DST-aware). The server must remain running. Existing in-flight runs are reused; scheduled reviews reuse completed research for the same effective trading session. Calendar failure follows the platform's natural-date fallback. Closed holdings pause their schedule at the next trigger. Failures remain visible and can be retried. Browser navigation does not stop work; server restarts interrupt in-process runs. This is a single-service scheduler, not a distributed exactly-once system.

New endpoints live under `/api/v1/workspace/portfolio-research`: cached dashboard GET, explicit quote-refresh POST, per-account/symbol plan GET/PUT and research-run POST. Existing research runs, ledger APIs and schedules remain compatible. No new environment variables or database columns are required. Build Web and restart the server to deploy. Before rolling back code, disable holding schedules; keep the ledger and history intact.
