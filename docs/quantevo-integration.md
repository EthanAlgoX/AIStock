# QuantEvo 交易推演融合 / QuantEvo integration

交易推演增加管理员来源工作区：`/trading?view=source`。默认视图仍为模拟总览。主站负责认证、页面和周期计划，QuantEvo 负责不可变版本、冻结回测、规则研究、资格和模拟账本；主站通过 HTTP 连接，不导入来源应用或直接读写其数据库。

## 当前能力

| 环节 | 已实现 | 边界 |
| --- | --- | --- |
| 来源目录 | 策略、当前版本与版本历史、市场、回测历史 | 来源配置只读；不能通过本地日线编辑器修改 |
| 研究 | 来源研究历史、逐次实验、手动规则研究、任务进度与取消 | 冻结本版本的全年样本、成本、资金及引擎；不调用模型 |
| 候选 | 分别展示迭代资格和模拟资格、政策、原因和绑定证据 | 不能用旧 `passed` / `finalChecked` 推断新资格 |
| 模拟 | 合格候选独立模拟、异步回执、来源账户详情与启停 | 不提升主版、不替换旧账户、不自动恢复停止账户 |
| 周期研究 | 显式创建有限次数计划、暂停 / 恢复、保存每轮回执 | 只产生研究结果；固定来源主版和回测，不自动接续新版本 |
| 兼容 | 原生正整数账户与私有负整数对象共存、旧桥接继续可用 | 缺少新合同的旧来源关闭新写入口；成员不访问管理员来源 |

当前私有适配器在 QuantEvo 的现有应用内注册 `/api/ai-stock`，合同版本为 `quantevo.ai-stock.v1`。它复用已有锁、任务池和数据库，每个数据目录仍只允许一个写入进程。不要同时运行一份复制应用来代理同一账本。

目录和已有结果涵盖来源实际具备的美股、港股、A 股和加密策略。通用 `grid` / `ma_cross` 加密现货策略可在冻结证据有效时发起规则研究和候选模拟；股票日线、证券红利网格、ETF 小时、跨市场及专用加密策略族目前保留只读展示，新写能力由各族能力声明关闭。原生 QuantEvo 有专用回测路径不等于桥接已支持该写合同。新建来源策略、专用族写入、模型研究、主版提升、账户替换和成员来源隔离仍未接入。

## 使用流程

1. 管理员进入交易推演的“来源策略”视图，选择策略和版本；查看完整回测窗口、成本和当前政策。
2. 在当前主版下选择可研究的完整年度冻结回测，设置单轮实验预算，发起一次规则研究。任务区和请求回执显示进度、失败或取消原因。
3. 从研究记录打开候选版本，分别核对迭代资格、模拟资格和执行能力。合格候选可明确发起独立模拟；成功后打开真实来源账户。旧账户的资金、持仓和历史保持原账本。
4. 需要周期研究时，显式设置间隔、每轮预算和总次数。首次运行在一个完整间隔后开始；默认间隔 24 小时、最多 3 轮，每轮 12 次实验。可以暂停或经重新核对冻结合同后恢复。
5. 写入超时后先核对同一请求回执。刷新或重新打开页面仍追踪已保存的请求；只有来源明确返回回执不存在（404）时，才允许重送同一个请求 ID 和原载荷。`UNKNOWN` 不自动重送。

周期计划的实际限制取主站与来源合同中更严格的一项：至少间隔 1 小时、每轮最多 16 次实验、总共最多 20 轮。计划按 SQLite 原子领取，每次调度只核对一个计划，按最后核对时间公平轮转。先保存确定的请求 ID 再调用来源；重启、超时或领取租约恢复继续核对同一轮，不创建另一轮来猜测结果。暂停不取消已经接受的来源任务，只追踪其终态。

每次提交前重新核对来源主版、回测内容、政策、引擎能力和部署 URL，变化则暂停计划并显示错误；已接受的任务继续追踪。来源不可用或资格预览失败时，仍可查看主站已保存计划并本地暂停；恢复继续核对来源合同。曾收到 `UNKNOWN` 的事实单独持久保存，即使随后暂时变为 `PENDING` / `RUNNING`、再返回 404 或服务重启，也不允许自动重送这一请求；原请求仍可通过终态回执完成。次数用尽完成，失败或取消终止计划。规则周期研究的合同明确 `modelCalls=false`，页面不能通过计划启用模型、启动模拟、提升主版或替换账户。

旧库首次增加这一持久标记时，已接受的 `PENDING` / `RUNNING` 请求同样禁止缺失回执后的重送，因为旧库只保留最新状态，无法证明它们此前没有收到 `UNKNOWN`；尚未提交的 `RESERVED` 请求仍可按同一键恢复。后续重启不把新请求一律标为未知。计划暂停 / 恢复与回执落库在同一 SQLite 写事务中核对状态和租约，已完成计划不能被并发控制改回运行，过期工作者不能覆盖新租约的结果。

## 资格、资金和生命周期

来源当前采用 `all_markets_strict_sharpe_v3`：同市场、同标的池、同冻结完整一年、同成本和执行 / 风控框架，候选成本后夏普严格高于父版；父版与当前主版不同时还须高于当前主版。负夏普的改善可以登记研究进展，模拟仍须绑定本版本有效的全年成本后正夏普证据，并满足来源执行与行情条件。合成数据可研究，不能启动前向账户。

权威资格由来源读接口提供，在异步写入执行前重新检查。主站原生规则研究保留自己的合同，不把这一政策施加到另一引擎的历史记录。完整覆盖请求的回测仍可能因为不足一年或摘要失效而不支持研究，页面分别展示完整性与能力。

来源候选模拟复用原生准入逻辑，独立新账户从来源规定的前向本金开始；回测利润不计入模拟本金。已有同版本运行账户由来源返回复用结果，不重复建立。来源启动或恢复失败不会转成本地账户。

来源原生是 `STOPPED` / `resume`。桥接把主站的 pause / stop 动作保存在动作日志中；两者均停止来源账户，明确恢复调用原生 resume，重新核对本版本证据并保留资金、持仓和历史。桥接没有使用主站日线运行轮次替换来源原生 `paper_runs`；来源停止后的恢复沿用其原生运行段语义。总览、历史回放和账户详情保留来源收益口径，缺失费用、现金、成交时间、基准和执行周期保持未知。

暂停意图绑定来源原生运行段；通过来源网站另行恢复、停止后，不沿用旧段的暂停标签。详情逐点追加 `sourceReturn`、`sourceDrawdown` 与 `breakBefore`，总览曲线追加 `breakBefore`；缺失来源收益 / 回撤保持空值，不用账户金额补造。`externalEvidence.performanceBasis` 明确金额或单位净值，`metricsScope` / `curveScope` 分开说明账户累计指标与当前运行曲线。展示限幅只选择原观测、保留首末与局部极值，并传播行情缺口，原始账本和指标不变。

来源实时报价账户须有原生已持久化的观测，才展示账户累计收益；初始占位值保持未知。暂停后恢复即使当前运行曲线只有一个起点，已知的账户累计收益仍保留。来源目录与总览复用同一次只读快照和批量对象映射，避免逐账户重复建表或加载完整曲线导致主站超时；不缓存跨请求账户状态。

已确认的通用 `ma_cross` / `grid` 加密实盘行情模拟读取原账户冻结周期，并声明 UTC、实时报价估值与报价模拟成交；不能从日级信号推断为日级估值。没有足够依据的专用族时间合同仍保持未知。

来源账户不提供主站的“运行一次”；持续运行调用来源恢复合同。历史回测从版本配置区按原冻结资金、日期和成本提交验证，来源接受后自行执行，不对回测记录追加账户启停动作。排队、运行和失败时仍能查看详情及安全任务进度；映射保存原版本和配置，完成沿用同一负整数 ID。隐藏来源回测只移除界面记录，已接受的来源任务继续执行，结果和审计保留；界面不提供恢复。缺少冻结元数据的旧任务需要核验迁移，不能猜测当前主版。

「管理策略」隐藏来源版本时，只从该管理目录移除，并停止属于该版本的运行 / 暂停模拟账户；来源版本目录、原始版本及历史账本继续可查。已接受的回测、研究和主站周期计划继续按各自状态执行，不能用原生策略删除文案宣称它们一并取消。单独停止来源账户同样不停止研究计划。

## HTTP 与存储合同

Web 客户端复用 `apps/dsa-web/src/api/portfolios.ts`。主站根路径为 `/api/v1/simulation/portfolios/runtime`；表中路径追加在根路径之后。来源路径为 `/api/ai-stock` 追加相同路径；周期计划仅保存在主站。

| 方法与路径 | 响应 / 用途 |
| --- | --- |
| `GET /capabilities` | 主站返回 `{configured, available, capabilities, legacy}`；来源返回版本化能力对象 |
| `GET /strategies` | 稳定负整数策略 ID、来源字符串 ID、主版本和市场 |
| `GET /strategies/{id}/versions` | 来源版本字符串 ID、负整数 definition ID、父版本、资格和执行能力 |
| `GET /strategies/{id}/backtests`、`GET /strategies/{id}/research` | 冻结回测、年度指标、研究结果与逐次实验 |
| `GET /tasks`、`GET /tasks/{id}`、`POST /tasks/{id}/cancel` | 仅桥接创建的任务；取消仅支持规则研究，候选账户启动及冻结回测不支持取消 |
| `GET /versions/{id}/candidate-preview` | 迭代 / 模拟资格、原因、绑定证据和已有账户 |
| `POST /versions/{id}/candidate-paper` | `{requestId}`，主站 202 返回异步回执 |
| `POST /versions/{id}/research` | `{requestId, sourceBacktestId, budget}`，主站 202 返回规则研究回执 |
| `GET /requests/{requestId}` | 同一请求的持久化状态和结果 ID |
| `GET/POST /research-plans`、`POST /research-plans/{id}/control` | 列表、创建计划、`action=pause/resume`；仅主站 |

请求 ID 使用规范 UUID；来源策略、版本、回测、任务 ID 使用有长度上限的安全字符。主站只代理上述白名单，校验有限 JSON、字段结构、负整数对象身份、请求关联和完成后的账户引用，不透传私有错误正文。

能力探测追加兼容字段 `legacy`：仅来源 `/capabilities` 明确返回 HTTP 404 时为 `true`。超时、无效 JSON、不兼容合同和其他错误均为 `false`，不能据此启用旧研究写入口。未配置或成员工作区也返回 `false`；既有旧桥接读接口保持可用。

来源用唯一约束持久保存对象映射与写入指纹；同一个请求 ID 对不同操作返回冲突，同一个请求重复提交返回已有回执。未知状态不会自动再执行。主站 `simulation_runtime_research_plans` / `simulation_runtime_research_operations` 保存计划、租约、冻结指纹和轮次请求，原生账户表不变。来源审计仍由 QuantEvo 原生账本和桥接动作 / 请求表保存；现有主站 `runtime-records` 文件正文分页合同尚未由此桥接适配，不能把接口存在误认为完整证据已导入。

来源原生写入已经开始后，如果桥接映射或回执保存失败，返回 `UNKNOWN` 并保留已知原生结果 ID，不能宣称没有创建账户。重启后的未绑定写任务同样需要核验；已经绑定原生任务的请求继续读取其真实状态。同键查询不再次执行，主站不能根据缺失映射猜造账户 ID。

## 配置、切换和回滚

继续使用已有 `SIMULATION_RUNTIME_URL`，不增加端口或路径配置开关。值必须包含私有适配前缀，例如由部署填写实际内部地址并以 `/api/ai-stock` 结尾。不要指向 QuantEvo 原生 `/api` 根路径。来源只允许可信内部网络访问，主站负责登录与管理员归属；普通成员仍使用独立的原生能力。

QuantEvo 已通过独立行情子进程复用主站数据源；本次融合不改变它的密钥、提供方、市场或行情更新配置。浏览器不能选择来源 URL、目录、模型或内部账户归属。

上线前必须核对真实运行实例、备份两个数据库及配置，并确认旧负整数 ID 映射。新桥接的持久映射不能推断旧适配器的历史负 ID，也不能按列表顺序、名字或重算序号声称兼容。旧桥接和独立 QuantEvo 实例有不同账本时，先明确迁移映射与权威账本再切换；代码验收不代表已完成生产迁移。部署不自动恢复此前停止的服务或账户。

本项目已选择独立 QuantEvo 账本作为上线权威来源，旧 private-runtime 账本保留为历史。此选择不等于历史对象 ID 已迁移；生产切换仍须核对映射，不能混合两套账本的资金与收益。

回滚匹配的主站 / 来源适配器代码和环境 URL，保留两端已有账本、对象映射与回执；停止或暂停新增周期计划，避免旧镜像不认识计划而继续重复调度。若只关闭来源入口，可清空 URL，原生策略继续可用。运行中的来源模拟由其单写入服务独立管理，切换主站不应隐式停止或恢复它们。新写入后的数据库不被旧备份覆盖。

## 验证

```bash
.venv/bin/python -m pytest -q tests/test_source_runtime_contract.py tests/test_runtime_research_plans.py tests/test_runtime_research_plan_concurrency.py tests/test_simulation_runtime.py tests/test_simulation_runtime_sessions.py
PATH="$PWD/.venv/bin:$PATH" ./scripts/ci_gate.sh
cd apps/dsa-web
npm run test
npm run lint
npm run build
```

来源私有仓库有 `tests/test_ai_stock_bridge.py`，在导入来源应用前建立临时 home，使用全年合成行情和真实原生资格 / 任务 / SQLite，阻止外部行情与模型调用。公开仓库的 HTTP 测试使用真实本地 HTTP 边界，周期计划使用临时 SQLite；浏览器联调使用两端隔离服务。生产证券行情、模型研究、生产迁移和服务器恢复须独立验收，不能由离线测试推断可用。

## English

The owner trading workspace now has a source view at `/trading?view=source`: strategy/version catalogs, frozen backtests, research experiments, authoritative eligibility, durable asynchronous requests, tasks, candidate paper accounts and bounded periodic rules research. The default paper overview and native positive IDs remain compatible. Members cannot access the owner's single-user source runtime.

Register the versioned `/api/ai-stock` bridge inside QuantEvo's existing single-writer application. Configure the existing `SIMULATION_RUNTIME_URL` with that full internal prefix. Never import the source application into the main process or start a duplicate writer against the same home. Existing legacy negative IDs require an explicit reviewed migration before switching sources.

The main capability wrapper adds `legacy` to `{configured, available, capabilities}`. It is `true` only when the source `/capabilities` explicitly returns HTTP 404. Timeouts, invalid JSON, incompatible contracts and other errors return `false` and cannot enable legacy research writes; unconfigured and member workspaces also return `false`. Existing legacy read endpoints remain available.

The bridge currently permits generic grid/MA crypto-spot research and eligible candidate starts. Specialized securities, hourly ETF, cross-market and specialized crypto families remain read-only. Source strategy creation, model research, promotion, replacement and member source isolation are not implemented. Frozen annual strict-Sharpe iteration eligibility and positive-Sharpe paper eligibility are displayed separately and rechecked by the source on writes; synthetic datasets cannot start forward accounts.

Research plans are explicit, rules-only (`modelCalls=false`) and finite: at least one hour apart, at most 16 experiments per cycle and 20 cycles. The first cycle starts after a full interval. Each plan fixes the source strategy, current version, backtest, policy and capability fingerprint. SQLite leases and persisted deterministic request IDs prevent duplicate cycles; one plan is checked per scheduler tick with fair rotation. Pausing tracks accepted work without canceling it. Changes to frozen context pause the plan; failed/canceled cycles stop it. Plans never promote, replace or resume paper accounts.

Saved main-app plans remain visible and locally pausable when the source or candidate preview is unavailable; resume still validates the source. An additive SQLite flag remembers every authoritative UNKNOWN receipt. Later PENDING/RUNNING responses, missing receipts or restarts cannot re-enable resubmission for that request; a subsequent terminal receipt can still resolve it. Scheduler steps isolate failures so unrelated services cannot prevent receipt reconciliation.

On the first legacy schema upgrade, accepted PENDING/RUNNING operations also become non-replayable because overwritten history cannot prove they were never UNKNOWN. Unsubmitted RESERVED operations remain recoverable with the same key; ordinary subsequent restarts preserve the recorded flag. Lifecycle controls and receipt writes validate state/lease under a SQLite write transaction, preserving terminal plans and rejecting expired workers.

After a timeout, query the same durable receipt. Only an explicit missing receipt allows resending the identical key and payload; UNKNOWN never causes a blind retry. Source ledger origin, account state and native run semantics are preserved. The legacy file-body audit pagination has not been adapted by this bridge; native source ledgers and bridge journals remain the audit authority.

Bridge failures after native mutation starts produce UNKNOWN and retain any known native result ID, rather than falsely reporting that no account was created. Interrupted unbound writes require reconciliation; bound native tasks remain authoritative. Repeated queries never execute again or invent mapped account IDs.

Source paper controls pause/resume through the native lifecycle and do not offer a single-step run. Frozen backtest validation starts an asynchronous source job without account control calls. Pending, running and failed results stay readable; persisted version/config metadata and the negative ID survive completion. Hiding a source backtest removes its UI entry while accepted jobs continue and results/audit remain; the UI has no restore action. Older task mappings without frozen metadata require reviewed migration. Only research tasks support cancellation.

Hiding a source version removes it from the management catalog and stops its running/paused paper accounts. Its source catalog entry, immutable version and historical ledgers remain readable; accepted backtests, research and main-app periodic plans continue independently. Stopping a paper account does not cancel a research plan.

Pause intent is tied to its native run, so a later source-side resume/stop cannot inherit an earlier pause label. Point-level sourceReturn/sourceDrawdown preserve authoritative values and remain null when unavailable; breakBefore preserves feed gaps. The performance basis and metric/curve scope distinguish unit NAV from cash-flow-sensitive equity and lifetime metrics from current-run curves. Bounded display sampling retains original endpoints/extrema without changing ledgers or metrics. Confirmed generic crypto live providers declare frozen signal cadence, live-quote valuation, quote simulation and UTC observation timing; unsupported specialized timing remains unknown.

Live-quote accounts expose cumulative return only after a persisted native observation; initial placeholders remain unknown. Resuming into a one-point current-run curve does not suppress known lifetime returns. Catalog and overview reads share a request-scoped read-only snapshot and batch ID mappings rather than rebuilding schemas or loading full curves per account. No account state is cached across requests.

This project has selected the independent QuantEvo ledger as the authoritative production source, retaining the old private-runtime ledger as history. Historical object IDs still require reviewed mapping before cutover; cash and returns from the two ledgers must not be merged.

Tests use disposable databases, a real HTTP boundary and native source logic with blocked external feeds/models. Deployment still requires matching images, backups, ID migration and operational approval for previously stopped services. Roll back code and the URL without overwriting new ledger writes or implicitly changing source account states. README is unchanged because module contracts and rollout details belong in this document.
