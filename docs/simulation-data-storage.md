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
