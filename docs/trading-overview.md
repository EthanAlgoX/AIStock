# 交易推演：先看模拟收益

`/trading` 默认展示正在模拟运行的账户收益曲线，而不是策略配置。原生日线账户按自己的初始资金计算收益，来源账户保留来源的资金 / 单位净值口径，并说明指标与曲线范围；共用 UTC 时间轴。默认不展示暂停或停止的账户，可用筛选开关包含它们。历史回测不进入总览曲线，也不会计入模拟收益。

- 可按市场、观察时间范围筛选，勾选要对照的账户，并显示已有的基准曲线。时间范围仅裁剪展示，不重设收益起点。不同币种、开始时间及观察周期的账户不构成同口径排名。
- 策略条目默认按当前累计模拟收益率降序排列，每次刷新自动重排；零收益排在负收益之前，无有效收益数据的账户排在末尾，同收益按账户 ID 稳定排序。排序使用完整模拟账本的收益率，不随曲线显示窗口改变；展开状态跟随账户保留。
- 总览每 30 秒刷新，也可以点「刷新数据」手动拉取总览及已展开的详情。更新时间来自实际账本；无观测显示为空，错误不会改成零收益。私有引擎不可用时显示提示，原生账户仍可查看。停止或失败的更新不外推收益。
- 曲线接口仅传输摘要与保留局部极值的观测点；收益和最大回撤按完整账本计算。原始逐日 / 逐次记录在详情中。总览不发出下单、模拟运行或模型请求。
- 收益纵轴按当前可见曲线跨度调整百分比精度，小幅收益不再显示重复刻度或负零；展示精度不改变观测值和累计指标。
- 收益曲线下只有一组可展开策略条目：点击条目在原位查看成交持仓、决策、表现和研究，同一时间只展开一个。复选框只控制曲线显示，不触发展开。详情按需加载，收起后停止刷新；没有独立的底部详情区。配置与启停从「管理策略」或展开项中的「策略设置与运行控制」进入。
- 原生固定规则使用现有参数研究：冻结样本、训练 / 验证 / 最终检查，通过后另存候选。旧私有桥接研究按其预算与回撤合同执行，来源仅完成训练和验证时明确显示「待最终检查」。QuantEvo 版本化来源工作区使用自己的年度冻结评测与资格政策；不能把两种研究的通过标记互相替代，不调用生成模型、不替换运行账户。
- 私有模型策略如缺少可复核的无模型搜索合同，显示不支持原因，不调用今天的模型补做历史预测。研究记录保留来源评测划分和参数实验；来源文本与字段按原文保存。

接口：`GET /api/v1/simulation/portfolios/overview` 返回当前工作区模拟账户摘要。私有运行引擎可实现 `GET /overview` 和 `GET/POST /portfolios/{id}/evolution`。后者只对管理员的负整数私有账户开放，普通成员不能访问。来源研究历史与候选保存在服务器，不进入 Git。

验证关注：回测排除、空数据、曲线极值、完整回撤、工作区隔离、市场筛选、默认折叠、候选最终检查状态，以及宽屏 / 手机与五种界面语言。

回滚：恢复前一主站镜像与私有适配器备份；无需删除原生或私有账本。不得把备份数据库覆盖到仍运行的引擎上。

## English

The trading workspace opens with forward simulation returns, followed by one accordion of strategy rows. Only one row expands at a time, directly below its summary. Checkboxes control curve visibility independently. Full details load only when expanded and stop refreshing on collapse. There is no second detail section at the page bottom; configuration and lifecycle controls have a dedicated management entry. Native daily accounts use their own initial capital; source accounts retain their declared capital/unit-NAV basis and metric/curve scope. They share a UTC timeline. Historical backtests never enter forward curves. Paused/stopped accounts are opt-in. Market, display-period and series filters apply only to presentation; they do not rebase returns. Available benchmarks are optional and missing data is not fabricated. Different currencies, start dates and observation periods do not form a comparable performance ranking.

Strategy rows sort by current cumulative forward return, descending, on every refresh. Zero returns precede losses; missing or non-finite returns appear last, with account ID breaking ties consistently. Sorting uses full-ledger returns regardless of the chart display window, and expanded details remain attached to their account.

The overview refreshes every 30 seconds using recorded observation times. The manual refresh also reloads an expanded account's details. Empty histories remain unknown; refresh failures retain the previous data with a warning. Compact curves preserve local extremes; return and drawdown summaries use the complete ledger. Full records remain in account details. Loading the overview does not execute trades, simulations or model calls.

Return-axis percentage precision follows the visible series range, keeping small returns distinguishable and avoiding negative zero. Display precision does not change observations or cumulative metrics.

Expand a strategy row for its records and research. Use “Strategy settings & controls” for configuration and lifecycle actions. Accounts with observations appear before those awaiting their first record. To start a native account, save its strategy and explicitly create a paper simulation; a historical backtest is a separate validation/research entry. Native rule research retains frozen samples and train/validation/final checks, saving accepted candidates separately. Legacy private research uses its bounded experiment/drawdown contract; a candidate with no final check remains pending. The versioned QuantEvo workspace has a separate frozen annual evaluation and eligibility policy. Its eligibility cannot be inferred from legacy pass flags. Neither flow calls generative models or replaces live accounts. Model-based versions without a reproducible model-free search contract show a limitation instead of requesting retrospective predictions.

`GET /api/v1/simulation/portfolios/overview` returns workspace-scoped summaries. Private runtimes may implement `GET /overview` and `GET/POST /portfolios/{id}/evolution`; private negative IDs remain owner-only. Strategy instances, research histories and candidates stay on the server. Source evidence retains original fields and language.

Validate historical exclusion, missing data, curve extremes, full-ledger drawdowns, workspace isolation, filters, collapsed details, final-check status and desktop/mobile layouts in all five UI languages. Roll back the main image and private adapter together; keep both ledgers and stop the runtime before restoring any database backup.


## 模拟成交明细 / Simulation execution records

实时来源账户的 BUY/SELL 执行记录保存在来源 `decisions`，不一定存在 `trades`。适配器只把已写入模拟执行账本、有有效数量和成交价的 BUY/SELL 映射到 `executionLedger`；HOLD、模型许可或暂停指令不算成交。详情优先展示全账户的成交记录，而不是只看最后一次估值。旧接口未提供明细时明确显示未知，不能据此声称无交易。单笔费用未知时留空，累计费用仍读取来源账本。当前现金与持仓按同一来源状态快照读取，历史现金缺失时不反推。

The source live engine persists BUY/SELL executions in `decisions`, not necessarily `trades`. Only confirmed execution records with valid quantity and fill price enter `executionLedger`; HOLD, model permissions and pause instructions are not fills. Details show account-wide executions independently of the latest valuation. Missing legacy details remain unknown, never evidence of no trading. Missing per-fill fees stay blank while account totals remain available. Current cash and holdings use the same persisted source snapshot; missing historical cash is not reconstructed.

## 分层详情与时间口径 / Detail layout and timing

汇总页继续同时展示不同周期的模拟账户，并分别标注决策节奏和估值方式。首页原位展开默认查看「成交与持仓」，管理页进入账户默认展示「表现」；「成交与持仓」「决策记录」「回测与进化」「口径与证据」按需切换，策略配置及验证账户折叠。中断或未完成回测的指标始终标记为部分结果。

- 日级原生账户按交易日查看决策，下一交易日开盘模拟成交。
- 来源账户依据明确的 `timing` 合同展示信号周期、估值方式、执行规则和时区；小时信号可以同时使用实时报价估值。每次估值不等于决策或成交。
- 不完整的旧来源合同标记为待确认，不猜测为日级。决策原文与时间保留；来源完整往返交易不拆成虚构逐笔成交。
- 详情收益和回撤使用真实时间轴；7 / 30 天仅裁剪窗口，不重新计算收益起点，回撤保留窗口之前的已提供高点。来源仅提供本次运行曲线时明确标注范围，不能声称该曲线包括账户历史全部高点。实时报价的非等间隔样本不推算年化和夏普。

The overview combines forward accounts across cadences and labels signal frequency separately from valuation. Inline details open on Executions & positions; the management view opens on Performance, with separate tabs for Executions & positions, Decisions, Backtest & evolve, and Methodology & evidence. Configuration and validation accounts stay collapsed. Incomplete backtests always show a partial-result warning.

Native daily accounts retain trading-date decisions and next-open execution. Source accounts declare `timing` (signal timeframe, valuation, execution, timezone, granularity); hourly signals can coexist with live-quote valuations. Legacy missing contracts remain unknown. Original decision times and text are preserved, and round trips are never fabricated into individual fills. Detail charts use real timestamps; display windows do not rebase returns or reset previously supplied drawdown peaks. Source curves restricted to a selected run are explicitly scoped and cannot claim all lifetime peaks. Irregular live observations do not imply annualized return or Sharpe.

## 功能与逻辑检查 / Feature and logic audit

以下以当前网站可达的交易推演流程为边界；旧 `/simulation` 与 `/decision-signals` 页面跳转到 `/trading`。API 兼容入口继续保留，不新增另一套账本或执行器。

| 功能入口 | 操作与账本逻辑 | 关键检查 |
| --- | --- | --- |
| 模拟总览 | 只读前向账户，筛选市场、状态、观察窗口，勾选曲线与基准，按累计收益排序 | 回测不混入；无效收益和时间保持未知；手动刷新不改变筛选或执行交易 |
| 管理策略 | 配置市场、范围、决策后端、资金、费用与风险参数；预览确认范围后保存 | 配置与账户分别编号；编辑核对修订号，旧配置及账本保留；账户直链不能串到另一策略 |
| 原生历史回测 | 冻结日期、范围和成本，逐交易日信号、次开盘成交 | 行情有效后才落账；不使用未来行情；中断结果为部分结果；AI 历史回放保留模型知识限制 |
| 原生日线模拟 | 「运行一次」检查最新已收盘行情，「持续模拟」交由调度器检查 | 重复检查不重复落账；现金、持仓和费用一致；暂停关闭自动买卖并继续估值，仍可显式手动运行一次 |
| 账户与运行控制 | 暂停 / 恢复延续原生轮次；停止 / 再启动登记新轮次，保留账户资金与持仓 | 旧租约不能写入新轮次；隐藏保留审计；更改配置后的新验证从指定本金重新开始 |
| 五栏账户详情 | 表现、成交持仓、决策、研究、口径证据按需加载 | 不把决策当成交；缺失费用、现金、时间、基准保持未知；不同样本和成本不能直接排名 |
| 原生规则研究 | 冻结已保存样本，分段评测参数候选，通过最终检查后另存 | 不修改来源账户，不伪造模型回放；保持自身研究合同 |
| 历史研究提案 | `view=reports` 查看 / 配置交易研究任务、关联已完成选股、定时运行并阅读成果 | 只产生研究提案与风险说明，不产生账户级成交、持仓或模拟净值；不能与账户回测混用 |
| QuantEvo 来源 | 版本、全年冻结回测、研究、任务、资格、独立候选模拟 | 主站只代理管理员白名单；主版、政策、资金和原账本由来源负责；专用只读族不能发起写操作 |
| 有限周期研究 | 主站保存计划与每轮 UUID，来源执行规则实验，暂停仍追踪已接受任务 | 有限次数、规则模式、不调用模型；源不可用仍可本地暂停；曾收到 UNKNOWN 的请求永不自动重送 |
| 刷新与异常恢复 | 页面按需轮询、保留旧数据和错误，调度各服务独立捕获失败 | 无效来源数字或重复 ID 不拖垮原生总览；单个服务失败不阻断其他账户和请求回执检查 |

历史研究提案入口独立读取 Skill、任务和报告目录，读取失败显示错误并允许重试。关联报告须是已完成、同市场的选股报告；切换市场清除旧引用，较早的冻结来源可以按原 ID 恢复。任务恢复完成后才能保存，保存 / 定时计划共用提交互斥，编辑策略或专家绑定后清除「已保存」标记。该入口的成果仍是提案，不替代模拟账户。

原生模拟执行写入的审计任务不进入可编辑提案目录，不能通过任务接口修改、执行、定时调度或归档；仍可按原 ID 读取任务与运行历史。识别依据是服务保存的外部执行标记，不根据停用状态猜测；普通停用提案仍可恢复编辑。

提案页面及服务端核对既有输入范围：初始资金至少 10,000，最大持仓数为 1–100 的整数，单股仓位 / 单日亏损上限为 0.1%–100%；所有值必须有限。省略配置时保留原默认值。这些提案约束不改变原生模拟账户的本金或风险规则。

完整来源合同、只读族和生产迁移边界见 [QuantEvo 融合指南](quantevo-integration.md)，账本及轮次证据见 [数据存储说明](simulation-data-storage.md)。离线回归与隔离浏览器联调验证功能合同；生产行情、真实模型、部署网络和历史负整数 ID 切换须另行验收。既有缺失历史证据不能通过页面修复补造。

The audit covers the currently reachable trading workspace: overview filters and refresh; strategy/universe configuration and revisions; historical validation and daily paper execution; lifecycle and execution periods; five detail tabs; native frozen-parameter research; owner-only QuantEvo source workflows; durable finite research plans; permissions and error recovery. Legacy page routes redirect to `/trading`, with compatible APIs retained.

Native pause disables automatic orders while preserving valuation; an explicitly requested manual single run remains available. Source paper accounts use their own pause/resume lifecycle and do not support single-step execution. Strategy/account links must agree, missing metrics remain unknown, and one failing scheduler service cannot starve other account or receipt checks. Plans remain locally pausable when the source is offline. Once a source receipt has been UNKNOWN, its request is never automatically resubmitted, even after a temporary PENDING/RUNNING recovery or process restart.

The historical proposal entry independently restores skills, tasks and report catalogs with explicit read errors/retries. A linked screening report must be completed and match the selected market; changing markets clears the reference, while older frozen reports remain recoverable by ID. Save/schedule wait for task restoration and share a submission guard; editing settings or capability bindings clears the saved indicator. Outputs remain proposals, never simulated account fills or NAV.

External-executor audit tasks stay out of editable proposal catalogs. Task APIs cannot edit, execute, schedule or archive them; their IDs and run history remain readable. The server uses its persisted external-execution marker rather than treating all disabled tasks as audits, so ordinary disabled proposals remain editable.

The proposal UI and server enforce the existing displayed input bounds: capital at least 10,000, integer position count from 1 to 100, and position/daily-loss percentages from 0.1 to 100. All values must be finite; omitted settings retain their defaults. These proposal constraints do not alter native paper-account capital or risk rules.

See the linked source integration and storage guides for frozen evidence, eligibility, history and rollout boundaries. Deterministic regressions and isolated browser workflows validate these contracts; production feeds, actual models, network exposure and historical-ID cutover require separate verification.
