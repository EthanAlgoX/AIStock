# 交易推演：先看模拟收益

`/trading` 默认展示正在模拟运行的账户收益曲线，而不是策略配置。各账户使用自己的初始资金计算收益，共用 UTC 时间轴；默认不展示暂停或停止的账户，可用筛选开关包含它们。历史回测不进入总览曲线，也不会计入模拟收益。

- 可按市场、观察时间范围筛选，勾选要对照的账户，并显示已有的基准曲线。时间范围仅裁剪展示，不重设收益起点。不同币种、开始时间及观察周期的账户不构成同口径排名。
- 总览每 30 秒刷新。更新时间来自实际账本；无观测显示为空，错误不会改成零收益。私有引擎不可用时显示提示，原生账户仍可查看。停止或失败的更新不外推收益。
- 曲线接口仅传输摘要与保留局部极值的观测点；收益和最大回撤按完整账本计算。原始逐日 / 逐次记录在详情中。总览不发出下单、模拟运行或模型请求。
- 「策略详情、回测与自进化」默认折叠。点击账户的「查看详情」进入既有运行记录；「回测与进化」优先打开该策略已完成的回测与参数研究。无回测时先从策略详情创建回测。
- 原生固定规则使用现有参数研究：冻结样本、训练 / 验证 / 最终检查，通过后另存候选。私有来源策略使用来源引擎的规则研究；预算和回撤上限受服务端约束，不调用生成模型、不替换运行账户。来源仅完成训练和验证时明确显示「待最终检查」，不能视作通过最终检查。
- 私有模型策略如缺少可复核的无模型搜索合同，显示不支持原因，不调用今天的模型补做历史预测。研究记录保留来源评测划分和参数实验；来源文本与字段按原文保存。

接口：`GET /api/v1/simulation/portfolios/overview` 返回当前工作区模拟账户摘要。私有运行引擎可实现 `GET /overview` 和 `GET/POST /portfolios/{id}/evolution`。后者只对管理员的负整数私有账户开放，普通成员不能访问。来源研究历史与候选保存在服务器，不进入 Git。

验证关注：回测排除、空数据、曲线极值、完整回撤、工作区隔离、市场筛选、默认折叠、候选最终检查状态，以及宽屏 / 手机与五种界面语言。

回滚：恢复前一主站镜像与私有适配器备份；无需删除原生或私有账本。不得把备份数据库覆盖到仍运行的引擎上。

## English

The trading workspace opens with forward simulation returns, followed by collapsed strategy details. Each account uses its own initial capital and a shared UTC timeline. Historical backtests never enter forward curves. Paused/stopped accounts are opt-in. Market, display-period and series filters apply only to presentation; they do not rebase returns. Available benchmarks are optional and missing data is not fabricated. Different currencies, start dates and observation periods do not form a comparable performance ranking.

The overview refreshes every 30 seconds using recorded observation times. Empty histories remain unknown; refresh failures retain the previous data with a warning. Compact curves preserve local extremes; return and drawdown summaries use the complete ledger. Full records remain in account details. Loading the overview does not execute trades, simulations or model calls.

Open an account for its existing controls, or choose “Backtest & evolve” to open its latest completed backtest and parameter research. If none exists, first create a backtest in strategy details. Native rule research retains frozen samples and train/validation/final checks, saving accepted candidates separately. Private rule research uses the source engine with bounded experiments and drawdown limits, without generative calls or replacing live accounts. A source candidate with no final check is labeled pending, never passed. Model-based versions without a reproducible model-free search contract show a limitation instead of requesting retrospective predictions.

`GET /api/v1/simulation/portfolios/overview` returns workspace-scoped summaries. Private runtimes may implement `GET /overview` and `GET/POST /portfolios/{id}/evolution`; private negative IDs remain owner-only. Strategy instances, research histories and candidates stay on the server. Source evidence retains original fields and language.

Validate historical exclusion, missing data, curve extremes, full-ledger drawdowns, workspace isolation, filters, collapsed details, final-check status and desktop/mobile layouts in all five UI languages. Roll back the main image and private adapter together; keep both ledgers and stop the runtime before restoring any database backup.


## 模拟成交明细 / Simulation execution records

实时来源账户的 BUY/SELL 执行记录保存在来源 `decisions`，不一定存在 `trades`。适配器只把已写入模拟执行账本、有有效数量和成交价的 BUY/SELL 映射到 `executionLedger`；HOLD、模型许可或暂停指令不算成交。详情优先展示全账户的成交记录，而不是只看最后一次估值。旧接口未提供明细时明确显示未知，不能据此声称无交易。单笔费用未知时留空，累计费用仍读取来源账本。当前现金与持仓按同一来源状态快照读取，历史现金缺失时不反推。

The source live engine persists BUY/SELL executions in `decisions`, not necessarily `trades`. Only confirmed execution records with valid quantity and fill price enter `executionLedger`; HOLD, model permissions and pause instructions are not fills. Details show account-wide executions independently of the latest valuation. Missing legacy details remain unknown, never evidence of no trading. Missing per-fill fees stay blank while account totals remain available. Current cash and holdings use the same persisted source snapshot; missing historical cash is not reconstructed.

## 分层详情与时间口径 / Detail layout and timing

汇总页继续同时展示不同周期的模拟账户，并分别标注决策节奏和估值方式。进入账户后默认展示「表现」；「成交与持仓」「决策记录」「回测与进化」「口径与证据」按需切换，策略配置及验证账户折叠。中断或未完成回测的指标始终标记为部分结果。

- 日级原生账户按交易日查看决策，下一交易日开盘模拟成交。
- 来源账户依据明确的 `timing` 合同展示信号周期、估值方式、执行规则和时区；小时信号可以同时使用实时报价估值。每次估值不等于决策或成交。
- 不完整的旧来源合同标记为待确认，不猜测为日级。决策原文与时间保留；来源完整往返交易不拆成虚构逐笔成交。
- 详情收益和回撤使用真实时间轴；7 / 30 天仅裁剪窗口，不重新计算收益起点，回撤保留窗口之前的高点。实时报价的非等间隔样本不推算年化和夏普。

The overview combines forward accounts across cadences and labels signal frequency separately from valuation. Account details open on Performance, with separate tabs for Executions & positions, Decisions, Backtest & evolve, and Methodology & evidence. Configuration and validation accounts stay collapsed. Incomplete backtests always show a partial-result warning.

Native daily accounts retain trading-date decisions and next-open execution. Source accounts declare `timing` (signal timeframe, valuation, execution, timezone, granularity); hourly signals can coexist with live-quote valuations. Legacy missing contracts remain unknown. Original decision times and text are preserved, and round trips are never fabricated into individual fills. Detail charts use real timestamps; display windows do not rebase returns or reset previous drawdown peaks. Irregular live observations do not imply annualized return or Sharpe.
