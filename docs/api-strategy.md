# 策略定义 API

当前实现位于 `/api/v1/simulation/definition`，旧 preview simulation API 保持兼容。

- `POST /strategies`：创建策略和 Draft。
- `GET /strategies`、`GET /strategies/{id}`、`POST /strategies/{id}/archive`：策略读取与软归档。
- `PUT /strategy-versions/{id}/draft`：事务化草稿保存；请求必须带 `revision`。
- `POST /strategy-versions/{id}/validate`：读取数据库图并运行静态校验。
- `POST /strategy-versions/{id}/publish`：需 `revision`、`changeLog`、`idempotencyKey` 和全部 warning 确认码。
- `POST /strategies/{id}/drafts`：从正式版本复制新的 Draft。
- `GET /strategies/{id}/versions`、`GET /strategy-versions/{id}`、`GET /strategy-versions/{id}/diff?against=`：历史、详情和可读差异。
- `GET /strategies/{id}/audit-events`：审计轨迹。

写入失败统一返回 `{code,message,details}`；核心代码包括 `VERSION_CONFLICT`、`VERSION_IMMUTABLE`、`PUBLISH_VALIDATION_FAILED` 和 `PUBLISH_WARNING_ACK_REQUIRED`。发布幂等键的重复请求返回第一次发布结果；相同键不同请求返回冲突。

补充接口：

- `POST /strategy-versions/{id}/diff-preview`：仅比较浏览器本地草稿与服务器草稿，不持久化本地 Prompt。
- `POST /strategy-versions/{id}/fork-local`：请求含 `baseRevision`、`newStrategyName`、`localDraft` 和 `idempotencyKey`；在事务中创建独立 Strategy/Draft。客户端身份、发布状态、版本号和 owner 字段一律忽略。

Connection 的 `fieldMapping` 是声明式 `{sourcePath: targetPath}`；不支持任意代码或表达式。

## 正式策略运行与自动选股研究

- `GET /runnable-versions`：仅列出 `PUBLISHED + immutable` 的策略版本。
- `POST /runs` 与 `POST /runs/{id}/execute`：历史兼容接口，需要 `inputSnapshot.stockCode`；运行中心不再调用或展示这条独立单标的执行路径。
- `POST /automatic-runs`：提交正式策略的后台自动选股研究批次，仅需 `{ "strategyVersionId": 123 }`。
- `GET /automatic-runs`、`GET /automatic-runs/{id}`：读取批次、冻结的选股参数、候选快照和每个候选的子运行状态。
- `POST /continuous-runs`：以 `{ "strategyVersionId": 123, "intervalSeconds": 900 }` 启动或恢复该正式版本的持续研究控制。
- `GET /continuous-runs`：读取运行中、暂停和终止的持续控制记录。
- `POST /continuous-runs/{id}/pause`、`POST /continuous-runs/{id}/terminate`：停止后续周期。已经开始的一个批次会完成并如实保留，接口不会取消或伪造其结果。

后台线程提交被拒绝时，`POST /automatic-runs` 返回 HTTP 503，`detail.code=AUTO_RUN_QUEUE_UNAVAILABLE`，`detail.details.batchId` 指向已保存的批次。仍处于 `queued` 的该批次更新为 `failed`，保留完成时间、通用队列错误和 `AUTO_RUN_FAILED` 审计；已被其他操作终结的状态不覆盖。重提会创建新批次，不执行原失败记录。内部持续控制器使用的未入队批次保持原契约。

自动批次从版本读取并冻结 `dataPermissionSnapshot`、`screeningPolicy` 和 `marketScope`。`marketScope.universeMode=fixed` 时，运行服务先确认 K 线来源已启用且所有固定代码都存在于输入数据，然后在任何策略 Agent 之前把候选限制为该股票池，不调用全市场选股器；自动选股模式才使用已有 K 线选股服务。候选输入随后直接交给已发布 Agent 图的根 ANALYSIS Agent；标准新图按 ANALYSIS、DECISION、REFLECTION 顺序执行，REFLECTION 使用 `POST_RUN_CONTEXT` 且不改写当次决策。包含 INPUT Agent 的旧正式版本继续按冻结图兼容运行，从旧版本创建的新草稿会移除该节点并补齐版本级数据配置。提交新批次前运行中心会检查全局 LLM 渠道是否可用；未配置时前端禁用开始按钮并显示配置指引。批次和子运行均写入数据库；数据源或模型失败会保留失败原因。该 API 不创建真实订单、模拟成交、持仓、费用、PnL 或任何“自动买入”行为。

数据源目录接口位于 `/api/v1/simulation/definition/data-sources`。`GET` 返回系统内置来源和未归档的自定义目录项；`POST` 只接受名称、说明和无密钥 `connectionKey`，新条目固定归类为 `other`；`DELETE /{id}` 执行软归档，不改写已发布 StrategyVersion 中的冻结引用。新草稿和正式发布规范化为 schema v2，默认启用 K 线、新闻、基本面，并使用 `other.sourceIds` 保存扩展来源。

活动批次返回的每个 `candidates[]` 可包含 `agentProgress[]`，每项含 `agentId`、`agentName`、`agentType`、`status` 和可用时的 `durationMs`。这是持久化运行生命周期，不包含 Prompt 或 Secret；完整研究输出仍从 `GET /runs/{runId}` 获取。
