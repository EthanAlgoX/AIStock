# 私有交易推演运行引擎 / Private simulation runtime

交易推演可通过可选 `SIMULATION_RUNTIME_URL` 接入管理员维护的私有运行引擎，仍使用原策略列表、分市场筛选、回测与模拟详情。未配置时没有行为变化。来源策略实例、版本、参数、行情快照、模型回答和账户账本只保存在服务器，不作为公开仓库资产。

## 边界与部署

- URL 只能由部署环境配置，浏览器不能指定。私有服务不开放公网端口，只允许应用所在内部网络访问。主应用继续负责登录鉴权；普通成员工作区不能访问管理员的私有策略。
- 接口由服务端适配到现有组合响应格式。私有对象使用负整数 ID，本地账本保持正整数 ID，不覆盖或混合既有账户。
- 新版本保留来源引擎、周期及执行语义，不能把小时线收益冒充日线收益。每版独立显示；当前桥接的来源版本只读，不通过本地日线配置器修改。回测按钮按来源冻结区间、资金和成本复算，不能悄悄改变评测口径。
- 既有来源前向账本可连同状态导入；页面明确标记导入记录，服务器之后独立续跑。暂停私有账户会停止行情检查和交易；恢复保持原资金、持仓和版本。不存在把历史回测收益写入前向账本的操作。
- JEV 前向决策会使用服务器配置的 API。历史模型回放只能读取已归档回答，缺少记录即失败，不允许补发今天的模型请求假装历史预测。历史模型回放、固定池的事后选择偏差需要明确标注。
- 来源引擎可能将成交统计定义为完整往返交易，而不是订单数。保留来源计数和原始交易/持仓证据，不伪造缺失的现金、基准或逐笔成交。
- 私有服务离线时保留本地策略列表，并显示引擎不可用提示；私有对象操作返回错误，不降级为本地执行。

## 最小 HTTP 合同

`SIMULATION_RUNTIME_URL` 包含适配器路径前缀。返回 JSON，禁止重定向。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | 健康检查 |
| `GET /overview` | 仅模拟账户的紧凑收益曲线与完整账本指标 |
| `GET/POST /portfolios/{id}/evolution` | 来源规则研究历史 / 有界参数实验 |
| `GET /definitions`、`GET /portfolios` | `{items: [...]}`，每项 ID 为负整数 |
| `GET /portfolios/{id}` | 现有组合详情格式，`config.externalRuntime=true` |
| `POST /definitions/{id}/validations` | 冻结参数回测或取得该版模拟账户 |
| `POST /portfolios/{id}/control` | `action=run/start/pause/stop` |
| `POST /definitions/{id}/stop` | 停止该策略 |
| `DELETE /definitions/{id}`、`DELETE /portfolios/{id}` | 停止并隐藏私有对象，保留来源审计 |

主站另提供 `GET /api/v1/simulation/portfolios/runtime-status`。现有正整数 API 合同保持不变。HTTP 请求限时，不透传私有服务可能包含路径或密钥的错误正文。

部署前分别备份主应用数据库与私有运行目录。回滚先停止私有运行服务，再清空环境 URL 并恢复主站旧镜像；私有账本不删除，避免后台继续运行或丢失观察记录。

## English

An optional, deployment-managed `SIMULATION_RUNTIME_URL` bridges private strategy engines into the existing trading workspace. No configuration means no behavioral change. Strategies, versions, source snapshots, archived model answers and ledgers stay on the server. The public repository contains only the bridge, UI, documentation and synthetic tests.

The service must be reachable only on the internal deployment network. The main application authenticates requests and excludes member workspaces from the owner's private runtime. Clients cannot choose a URL or upload executable code. Negative integer IDs identify private objects; native positive IDs and ledgers remain intact.

Imported versions retain the source timeframe and execution semantics. Their configuration is read-only in the native daily editor. Backtests recompute the frozen source dates, capital and costs. Imported forward histories are labeled and continue independently on the server; backtest profits are never credited to paper accounts. Private pause stops quote checks as well as trading, and resume keeps the same account state.

Forward JEV strategies may call the configured API. Historical model replay must use archived answers and fail if they are missing; it is retrospective evidence, not a prediction recorded at the original historical time. Fixed-pool selection bias remains visible. Source trade counts may mean round trips rather than filled orders; missing cash, benchmark and fill details remain missing, with original evidence available separately.

The table above specifies the adapter contract. `config.externalRuntime=true` marks private portfolio responses. The main application exposes `GET /api/v1/simulation/portfolios/runtime-status`; native endpoints remain compatible. Requests are bounded and provider error bodies are not forwarded. On private-runtime failure, native strategies remain visible and the UI displays an availability warning.

Back up both runtimes before deployment. To roll back, stop the private service, clear the URL and restore the prior main image. Keep private ledgers for audit and recovery.

收益总览与进化语义 / Overview and evolution: see [trading-overview.md](trading-overview.md).


### Timing metadata / 时间口径

Portfolio details, list items and overview summaries can provide additive `timing`: `signalTimeframe` (e.g. `1h`, `1d`), `valuation` (`live_quote` / `bar_close`), `execution` (`quote_simulation` / `next_open`), `timezone` (`UTC` / `market`) and `granularity` (`observation` / `bar` / `trading_day`). An hourly signal does not imply hourly-only valuation. Legacy private responses without this contract remain unknown; they do not inherit native daily explanations. `externalEvidence.lastClosedBar` optionally identifies the most recent signal bar. These fields do not alter execution or scheduling.

详情、列表与总览可追加以上 `timing` 字段，分别声明信号周期、估值、成交与时间轴口径；小时信号不代表只能按小时估值。旧私有接口缺少合同则显示待确认，不套用原生日级文案。可选 `externalEvidence.lastClosedBar` 保留最近信号 K 线。元数据不改变执行或调度。
