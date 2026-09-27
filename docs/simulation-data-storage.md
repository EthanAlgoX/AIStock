# 交易推演数据持久化 / Simulation data retention

交易推演的事实记录必须保存到 SQLite。Markdown 仅作说明或导出，JSON/CSV 文件只能作为可恢复的导出或缓存，不能是唯一数据源。策略配置、数据样本、结果和调用证据保留实际生成时间；历史上从未保存的原始响应或重置前记录不能补造。

## 原生账户

- `simulation_portfolio_definitions`、`simulation_strategy_versions`：配置与不可变运行版本。创建、配置调整、启停和删除事件追加到 `simulation_audit_events`，删除账户只隐藏运行入口，不删除证据。
- `simulation_runs`：每日行情输入、来源、决策和输出。`simulation_orders`、`simulation_fills`、`simulation_positions`、`simulation_equity_snapshots` 保存订单、成交、当前持仓和历史净值；历史持仓同时保存在逐日输出中。
- `workspace_runs` 等既有工作区表保留每次运行的状态、失败原因和任务关联。
- `simulation_trading_calls`：LLM/JEV 输入、回答、模型、用量及错误。新增的 `simulation_trading_call_evidence` 关联原调用 ID，补充请求预算、单次输出上限、超时、原始供应商响应及完成时间。只保存模型请求与响应正文，不保存认证头和密钥；旧调用缺少的补充字段保持未知。
- `simulation_portfolio_research` 保存最终研究结果；`simulation_audit_events` 追加研究请求、阶段配置、候选逐日净值/成交/决策、失败和完成事件，以请求 ID 关联。失败前已经计算完成的日期立即入库。复用已有研究结果不会重复运行实验。

`GET /api/v1/simulation/portfolios/{id}/records?kind=calls|events|days|research&limit=50&before=<cursor>` 提供当前工作区的完整分页记录。详情页中的最近 20 次调用只是展示限制，不是数据库保留上限。`nextCursor=null` 表示没有后续页；已隐藏的原生账户仍可按 ID 查询证据。

## 私有引擎

复用来源 SQLite 中的 `backtests`、`paper_events`、`job_events`、`record_history`、`evolution_runs`、`experiments`、`operation_requests` 和 `llm_calls`。JEV 与生成式模型都应在请求前建立调用记录，在成功、解析失败、HTTP 错误或超时后保存结果和状态；缓存答案标注原生成时间，不能冒充新的 API 调用。

框架提供 `src/repositories/simulation_runtime_store.py`，将文件正文作为带 SHA-256 的 SQLite BLOB 存入 `runtime_documents`，`runtime_document_heads` 指向当前版本。相同路径内容变更保留旧版本；相同内容重复导入不重复插入。适配器必须先提交 SQLite，再生成可选文件副本；SQLite 校验或写入失败不能退回文件单独记账。

私有适配器应归档策略清单、桥接运行状态、回测全文、冻结行情、已有模型答案及研究报告正文。原始密钥文件、环境文件和数据库备份不作为业务文档导入。来源账本仍由原引擎事务写入，避免另建一套订单或模型调用账本。

主站新增只对管理员私有引擎可用的分页代理：

- `GET /api/v1/simulation/portfolios/runtime-records?kind=documents|llm_calls|paper_events|job_events|record_history|operation_requests|backtests|evolution_runs|experiments&limit=50&before=<cursor>`
- `GET /api/v1/simulation/portfolios/runtime-records/documents/{id}`：返回完整正文的 Base64 编码、SHA-256 和元数据。

成员工作区不能通过这些接口访问管理员的私有引擎。记录可能包含私人策略和模型输入，仅使用现有身份验证和内部运行网络，不能公开数据库或将实例数据提交 Git。

## 迁移与恢复

先对运行中的 SQLite 使用一致性备份，切换写入路径时停止对应引擎。迁移仅导入实际存在的文件并逐项校验字节和哈希，保留文件副本用于回滚；使用复制数据库验证关闭文件副本后仍能读取和复算。迁移不重置账户、不改变本金、不调用模型补做历史数据。

新增原生表由既有 `create_all` 创建，不改写旧模型调用；旧应用可忽略新增表。私有适配器回滚需要恢复配套代码和导出文件，必要时先停引擎再恢复数据库备份。不能用旧数据库覆盖仍在写入的运行实例。

## English

SQLite is the system of record for simulation configuration, inputs, executions, positions, equity, experiments and model calls. Markdown is documentation/export only. JSON/CSV files must be recoverable exports or caches. Missing historical evidence remains explicitly unknown.

Native ledgers retain existing account and daily-run tables. The additive `simulation_trading_call_evidence` table records transport options, complete normalized/provider responses and completion time alongside each model call, excluding credentials. Research audit events persist phase configurations and each completed candidate day immediately, including decisions, trades and equity; failures retain preceding work. Account lifecycle and configuration changes are audited. The native records endpoint above is workspace-scoped and cursor-paginated; the UI's latest-20 call limit never deletes older records.

Private engines reuse their existing backtest, paper-event, job, evolution and model-call journals. The framework's SQLite document store adds versioned, checksum-verified BLOB content, replacing file-only manifests, replay results, frozen bars and model-answer archives. Existing artifacts are imported without inventing historical API calls. Secret files and database backups are excluded. The private record/document endpoints above are owner-only and preserve source records in full.

Back up SQLite consistently, stop the affected engine during cutover, verify imported bytes and test recovery on a copied database. Migration must not reset accounts or invoke models. Native schema additions are backward compatible; private rollback restores matching adapter code and exports, with database restoration performed only while the engine is stopped.

## 逐笔操作证据 / Per-execution evidence

买入、卖出和被拒订单必须同时保留决策理由与执行结果，两者不能混用：执行失败原因不等于策略为什么发出订单。原生逐日 `trades` 新增 `decisionEvidence`，从前一信号的冻结意见传递完整分类/置信度（如有）、调用 ID、策略摘要和决策后端；字段存入既有 `simulation_runs.result_snapshot_json`，不另建账本。旧记录缺少直接关联时保持空值，可按策略版本、`signalDate` 查询原始逐日意见和模型调用。

私有引擎的成交应保存 `reason` 或 `decision_reason`、参考价、逐笔费用/滑点、成交前后现金/数量及信号周期；`paper_events` 在同一事务归档完整载荷。已有拒单口径的 `reason` 可继续表示执行失败原因，策略依据另存 `decision_reason` 与 `decision_evidence`。JEV 只能保存实际分类、概率和约束规则，不生成不存在的模型解释。缺失的历史理由和逐笔费用不补造。

可运行只读核查（输出包含私有运行元数据，不提交 Git）：

```bash
python scripts/audit_simulation_records.py /path/to/stock_analysis.db --engine native
python scripts/audit_simulation_records.py /path/to/quantevo.db --engine private
```

The read-only auditor uses a consistent SQLite snapshot and reports trade/order/fill count mismatches, missing reasons, private journal gaps, missing strategy versions and missing per-fill costs. Native executions now carry the frozen signal's `decisionEvidence`, including the opinion, model call ID and skill digest. Rejection reasons remain distinct from strategy rationale. Old missing evidence remains unknown; existing daily opinions and calls can still be traced by strategy version and signal date. No historical decisions or costs are fabricated.

## 市场版本与运行轮次 / Market versions and execution periods

SQLite 新增 `simulation_market_versions` 和 `simulation_portfolio_lineage`，把市场、策略定义、配置修订与账户关联。市场内版本号按已登记修订分配；原 `source_revision` 和旧 `strategy_version_id` 保留，不能把旧表中每次新账户生成的 `version=1` 当作唯一业务版本。市场版本冻结配置，账户本金、验证日期等运行参数保存在轮次配置快照。没有可靠定义关联的旧账户使用独立的历史标识，不按名称猜测合并。

`simulation_execution_sessions` 保存运行轮次 ID、顺序号、上一轮 ID、市场版本、起止时间、结束原因、起止账户状态和配置快照。明确停止、删除或更改配置结束当前轮次；停止后重新启动创建新轮次，但保留原账户现金和持仓。普通暂停/恢复、重复启动、调度检查、服务重启不创建新轮次。历史回测完成结束其轮次；错误重试继续原轮次。仅有历史状态而没有可靠启动事件的正在运行账户接入为 `adopted_unknown_start`，`started_at=NULL`，另记实际接入时间 `observed_at`，不补造旧轮次。

`simulation_session_evidence` 将轮次与工作区检查批次、逐日运行、模型调用及订单关联。订单通过既有订单 ID 继续关联成交；净值通过逐日运行 ID 关联轮次。模型调用在发出前固定所属轮次，停止时撤销执行租约，旧轮结果不能写进新轮账本。买卖理由、拒单原因、信号日期和时间口径分别入库。

时间口径：原生日线观测只证明交易日与开盘价模拟，新增 `timeContract.executionPrecision=trading_day`、`executionAt=null`，另存真实 UTC `recordedAt`。旧 `filled_at` 的午夜值仅作兼容，不表示真实逐笔成交时刻。私有逐笔模拟保留来源 timestamp。所有时间均需连同精度与用途解读，不能将写库时间当作成交时间。

原生详情追加 `marketVersion`、`executionSessions`，逐日输出追加 `executionSessionId`、`timeContract`。分页接口 `records?kind=sessions|executions` 可读取完整轮次和关联证据（含已隐藏账户）；旧响应字段继续兼容，默认累计收益仍按账户计算，不因新轮次清零。

私有适配器使用 `simulation_runtime_sessions.py` 在同一个 SQLite 中建立 `runtime_market_versions`、`runtime_execution_sessions`、`runtime_session_event_links`、`runtime_execution_batches` 和 `runtime_session_call_links`。市场由适配器明确注册，未确认市场保持空值；SQLite 触发器将启停和事件关联与原账本原子提交。行情/模型返回后，写入前必须在事务内验证轮次仍有效，错误处理也不能覆盖新轮状态。适配器负责把暂停与停止区分开。

迁移：先一致性备份、停止写入，再创建新增表，按旧账户创建顺序登记市场版本，对当前模拟账户接入未知开始时间的轮次。旧交易和历史 API 调用不按时间猜测轮次；继续保留原策略、账户和逐日关联。新增表不删除或改写原账本。回滚私有适配器时须同时停用新增运行轮次触发器，避免旧执行器绕过轮次校验；保留新增表供审计，不用旧备份覆盖发布后的成交。

### English

Additive SQLite tables separate market-specific immutable strategy revisions, continuous accounts, execution periods and individual scheduler batches. Explicit stop/start creates a new period linked to its predecessor without resetting cash or positions. Pause/resume and process restarts retain the period; completed backtests close theirs. Newly captured model calls, days and orders link to the period, while fills and equity remain reachable through their existing order/day foreign keys. A stale batch cannot commit after its period ends.

Legacy running accounts are adopted with an unknown start (`started_at=NULL`) and a separate observed-at timestamp. Historical trades are not assigned fabricated periods. Native daily execution precision remains a trading day; old midnight fill timestamps are compatibility values, not exact execution times. Additive detail fields and paginated sessions/executions endpoints expose these distinctions. Private adapters use the same SQLite-first contract with lifecycle/event triggers and guarded writes. Back up and stop writers before migration; retain evidence tables and disable private lifecycle triggers when rolling back to an executor without period guards.

停止对应实例写入并完成备份后，原生迁移命令为 `python scripts/migrate_simulation_sessions.py /path/to/stock_analysis.db`；成员工作区应对各自 `workspace.db` 单独执行。命令可重复执行，并将迁移计数写入 SQLite 审计表。私有适配器在启动初始化时调用 `install` 并注册可信市场映射；上次进程遗留的未结束检查批次标记为 `interrupted`，账户轮次仍保持连续。

After backing up and stopping writers, run the native migration command above separately for the owner and each member database. It is idempotent and journals migration counts in SQLite. Private startup marks unfinished checks as interrupted without creating a new account execution period.
