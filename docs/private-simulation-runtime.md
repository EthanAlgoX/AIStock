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
| `GET/POST /portfolios/{id}/evolution` | 旧来源规则研究历史 / 有界参数实验；QuantEvo v1 保留读取，写入使用版本化来源入口 |
| `GET /definitions`、`GET /portfolios` | `{items: [...]}`，每项 ID 为负整数 |
| `GET /portfolios/{id}` | 现有组合详情格式，`config.externalRuntime=true` |
| `POST /definitions/{id}/validations` | 冻结参数回测或取得该版模拟账户 |
| `POST /portfolios/{id}/control` | `action=run/start/pause/stop`；QuantEvo v1 明确拒绝单步 `run`，仅模拟账户支持显式启停 |
| `POST /definitions/{id}/stop` | 停止该策略 |
| `DELETE /definitions/{id}`、`DELETE /portfolios/{id}` | 停止模拟并隐藏对象，保留来源审计；QuantEvo 冻结回测仅隐藏，已接受的任务继续执行 |

主站另提供 `GET /api/v1/simulation/portfolios/runtime-status`。现有正整数 API 合同保持不变。HTTP 请求限时，不透传私有服务可能包含路径或密钥的错误正文。

大规模策略目录和收益曲线的 JSON 响应需检查实际传输时间。使用 Nginx 时，在已有压缩配置的 `gzip_types` 中包含 `application/json`（见[云部署示例](deploy-webui-cloud.md#配置文件示例)），并验收登录后的页面加载与手动刷新。只压缩 JS/CSS 不足以改善这些 API 响应。来源进程缓存重启或因原生回测审计更新失效后，首次目录读取仍可能超过主站 20 秒上游时限；发布时需受控 GET 预热和实际适配器验收，不能把健康检查或温热读取通过等同所有冷请求均可用。

部署前分别备份主应用数据库与私有运行目录。主站回滚先暂停新增来源研究计划，再清空环境 URL 并恢复兼容的主站镜像；独立来源模拟服务保持原状态，不能因主站切换隐式停止或恢复账户。若需要回滚来源自身，另行确认写入进程切换及账户状态，保留新账本、对象映射与回执，不能用旧备份覆盖新写入。

## English

An optional, deployment-managed `SIMULATION_RUNTIME_URL` bridges private strategy engines into the existing trading workspace. No configuration means no behavioral change. Strategies, versions, source snapshots, archived model answers and ledgers stay on the server. The public repository contains only the bridge, UI, documentation and synthetic tests.

The service must be reachable only on the internal deployment network. The main application authenticates requests and excludes member workspaces from the owner's private runtime. Clients cannot choose a URL or upload executable code. Negative integer IDs identify private objects; native positive IDs and ledgers remain intact.

Imported versions retain the source timeframe and execution semantics. Their configuration is read-only in the native daily editor. Backtests recompute the frozen source dates, capital and costs. Imported forward histories are labeled and continue independently on the server; backtest profits are never credited to paper accounts. Private pause stops quote checks as well as trading, and resume keeps the same account state.

Forward JEV strategies may call the configured API. Historical model replay must use archived answers and fail if they are missing; it is retrospective evidence, not a prediction recorded at the original historical time. Fixed-pool selection bias remains visible. Source trade counts may mean round trips rather than filled orders; missing cash, benchmark and fill details remain missing, with original evidence available separately.

The table above specifies the adapter contract. `config.externalRuntime=true` marks private portfolio responses. The main application exposes `GET /api/v1/simulation/portfolios/runtime-status`; native endpoints remain compatible. Requests are bounded and provider error bodies are not forwarded. On private-runtime failure, native strategies remain visible and the UI displays an availability warning.

Check transfer time for large catalog and performance-chart JSON responses. With Nginx, include `application/json` in the existing `gzip_types` configuration and verify authenticated page loading and manual refresh. Compressing only JS/CSS leaves these API responses uncompressed; API fields and ledgers are unchanged. After a source process restart or cache invalidation by a native backtest audit update, a first catalog read can still exceed the main adapter's 20-second upstream timeout. Deployment requires controlled GET prewarming and real adapter acceptance; health checks and warm reads do not prove every cold request usable.

Back up both runtimes before deployment. For a main-site rollback, pause new source research plans, clear the URL and restore a compatible main image without implicitly stopping or resuming independently managed source accounts. A source-service rollback requires a separate writer and account-state transition; preserve new ledgers, ID mappings and receipts. QuantEvo v1 rejects single-step `run` and directs new research writes to the versioned source endpoints; the legacy evolution endpoint remains read-only.

收益总览与进化语义 / Overview and evolution: see [trading-overview.md](trading-overview.md).

QuantEvo 版本化来源工作区、候选模拟、有限次数规则研究与上线边界 / Versioned source workspace, candidate paper accounts, bounded rules research and rollout limits: see [quantevo-integration.md](quantevo-integration.md). 新桥接的专用策略族暂为只读，旧负整数 ID 切换须显式核对；文件正文分页证据尚未由新桥接适配。Specialized families are currently read-only; legacy ID cutover requires review, and the new bridge does not yet implement file-body audit pagination.


### Timing metadata / 时间口径

Portfolio details, list items and overview summaries can provide additive `timing`: `signalTimeframe` (e.g. `1h`, `1d`), `valuation` (`live_quote` / `bar_close`), `execution` (`quote_simulation` / `next_open`), `timezone` (`UTC` / `market`) and `granularity` (`observation` / `bar` / `trading_day`). An hourly signal does not imply hourly-only valuation. Legacy private responses without this contract remain unknown; they do not inherit native daily explanations. `externalEvidence.lastClosedBar` optionally identifies the most recent signal bar. These fields do not alter execution or scheduling.

详情、列表与总览可追加以上 `timing` 字段，分别声明信号周期、估值、成交与时间轴口径；小时信号不代表只能按小时估值。旧私有接口缺少合同则显示待确认，不套用原生日级文案。可选 `externalEvidence.lastClosedBar` 保留最近信号 K 线。元数据不改变执行或调度。


## SQLite 数据合同 / SQLite persistence

私有运行适配器必须保留数据库中的完整账本、模型调用和文件正文，不能只写 Markdown 或文件路径。分页证据接口、迁移和恢复要求见 [交易推演数据持久化](simulation-data-storage.md)。

Private adapters must persist complete ledgers, model calls and artifact bodies in SQLite, rather than only Markdown or file paths. See [Simulation data retention](simulation-data-storage.md) for pagination, migration and recovery.

## Curve time-axis endpoints / 曲线横轴起止刻度

Overview and portfolio performance charts use explicit time ticks and preserve the first and last visible observation labels. Automatic calendar rounding must not hide the initial paper-account observation. Date-range filters use the filtered observations; no earlier point is synthesized. Tick and tooltip timestamps retain the existing UTC convention.

收益总览与策略详情的曲线使用明确时间刻度，保留当前可见观测的首尾时间标签，避免日历整点刻度隐藏模拟起点。时间范围筛选后以筛选内的观测为准，不补造更早数据点；刻度与提示继续沿用 UTC 时间。

Native daily paper snapshots use `recordedAt` (actual ledger booking time) on the combined intraday overview axis, not midnight of the signal's `date`. Strategy detail keeps the trading date. Existing timestamped observations and historical backtests are unchanged; legacy records without `recordedAt` retain their original date.

原生日线模拟在汇总时间轴上使用 `recordedAt`（实际记账时间），不再把信号的交易日期误读成当天凌晨。策略详情保留交易日期；带完整时间的观测及历史回测不变，缺少 `recordedAt` 的旧记录保留原日期。
