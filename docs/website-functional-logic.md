# Website workflows / 网站功能与执行逻辑

This map describes the routed Web application. A saved configuration, a completed model decision, and a simulated fill are distinct states.

本说明以当前 Web 路由及业务服务为准。“配置已保存”“模型已完成判断”“已产生模拟成交”是三个不同状态。

| Entry / 入口 | Input and responsibility / 输入与职责 | Output / 输出 |
| --- | --- | --- |
| Research assistant / 投研助理 | Questions, selected capabilities, optional expert collaboration / 对话需求、所选能力、可选专家协作 | Saved conversations and research; a separate strategy authoring conversation can produce a versioned Skill / 保存对话和研究；独立策略会话可生成版本化 Skill |
| Expert roundtable / 专家圆桌 | A topic, experts and collaboration mode / 主题、专家及协作模式 | Expert contributions and a synthesis / 专家发言与汇总 |
| Stock research / 个股研究 | One stock, a research strategy and available evidence; holding-linked research includes account context / 股票、研究方法和证据；关联持仓的研究带入账户上下文 | Evidence, conclusions, risks and reports / 证据、结论、风险与报告 |
| Strategy screening / 策略选股 | Screening strategy, market and scope / 选股策略、市场和范围 | Candidates and reasons, not orders / 候选和理由，不产生订单 |
| Trade simulation / 交易推演 | An approved universe, frozen Skill, model backend and account limits / 已确认股票范围、冻结 Skill、决策模型与账户约束 | Daily decisions, subsequent simulated fills, positions and equity history / 每日决策、后续模拟成交、持仓及净值历史 |
| Portfolio / 持仓管理 | Holdings or watch stocks, optional schedules / 持仓或关注股、可选跟踪计划 | Current briefs and independent daily score history / 当前简报与独立的每日评分历史 |
| Market radar / 市场雷达 | Market and news sources / 市场与资讯来源 | Research inputs / 研究输入 |

## Research and tracking / 研究与跟踪

- Holding research reads the actual holding context. Watch research does not infer positions or produce holding actions. Completed scores are assembled into a curve after independent research; previous report conclusions are not injected into the next analysis.
- “Save & enable tracking” saves the cadence, market-local time and notification preference. It enables scheduled research without running immediately. A manual research action is separate.
- Tracking uses calendar-day intervals. Trade simulation uses exchange sessions and closed daily bars. These schedules have different semantics.
- Scheduled research notifications require both the per-task notification choice and a configured delivery channel. The channel configuration alone does not start research.

持仓研究读取实际持仓；关注股研究不推断仓位、不输出持仓操作建议。每日分析独立完成后，再汇总评分曲线。保存跟踪配置只启用计划，不立即研究；临时研究走手动入口。跟踪周期按自然日，交易推演按交易日，两者不能混用。定时研究通知还需要任务通知开关和已配置渠道，配置渠道本身不会启动研究。

## From a strategy to daily simulation / 从策略到每日推演

1. Discuss and save a Skill, or select an existing Skill.
2. Choose a market and stock scope. For natural-language scope preview, obtain market/industry candidates first, then let the LLM select from that evidence.
3. Review the preview and save the strategy. This does not create a running simulation.
4. Choose a single run, continuous paper trading or AI historical replay, and confirm the validation parameters.
5. For each eligible day, simulate execution of the previous decision at the open, value positions at the close, then produce the next decision. A decision may produce no fill because of cash, lot or allocation limits.

先保存或选择 Skill，再选择市场与股票范围。自然语言范围先取得市场／行业候选，再由 LLM 从证据中筛选。核对预览并保存策略后，还需选择单次运行、持续模拟或 AI 历史回放。每日步骤先执行上一决策的模拟买卖，再估值并形成下一决策；有决策不等于必然成交。

JEV is an explicitly selected decision backend. It returns buy/sell/hold with probabilities and confidence; the program applies the configured allocation step and execution constraints. Research, chat and natural-language universe screening still require the configured LLM. JEV errors do not silently switch the backend. See [JEV execution](jev-trading-decisions.md).

JEV 需显式选择，输出买入／卖出／不动及概率、置信度；程序负责调仓比例和执行约束。研究、对话与自然语言范围筛选仍用 LLM。接口失败不会静默切换模型。当前没有低置信度自动停交易阈值。

Pausing a simulation stops automatic trading but keeps holdings valued. It does not mean removing historical records. Starting a server or saving an API key does not enable a strategy. The server must remain running for scheduled work; a local browser need not stay open.

暂停模拟是停止自动买卖、保留持仓估值，并非删除历史。启动服务器或保存 API 密钥不会自动启用策略。定时任务需要服务器持续运行，不需要本地浏览器保持打开。

## Supporting controls / 支撑入口

Tasks & Runs records execution status and artifacts; Scheduled tasks controls future execution; Model usage records consumption. Settings configures model services and delivery channels; the Capability Center manages selectable methods and tools. Member accounts use administrator-managed platform credentials and private workspaces.

任务与运行保存执行状态与成果；定时任务管理未来执行；模型用量记录消耗。设置管理模型服务与通知渠道，能力中心管理可选择的方法与工具。成员使用管理员维护的平台密钥，业务数据在私有工作区内保存。

See [holding research](holdings-research.md), [strategy execution](strategy-portfolios_EN.md) and [strategy execution in Chinese](strategy-portfolios.md) for detailed contracts.
