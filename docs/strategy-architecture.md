# 策略中心前端架构

InvestCrew 将交易策略视为第一对象。策略不是单一 Prompt 或独立 Agent，而是由多个 Agent Instance、数据授权、决策规则、风险边界、经验集合、版本和运行记录构成的可验证配置。

## 当前页面与路由

- `/overview`：策略驾驶舱；展示待处理事项、策略状态和验证前置条件。
- `/strategies`：策略模板与我的策略目录；模板需要复制为独立策略后再配置。
- `/strategies/:strategyId`：单个策略工作台。
- `/strategies/:strategyId/editor`：配置研究范围、输入数据、已发布 Agent 工作流和决策边界；不在此编辑 Agent 节点。
- `/agents`：Agent 模板库与多 Agent 工作流编排；正式工作流版本可供策略引用。
- `/data`：策略、回测和运行共享的数据来源与证据目录。
- `/backtests`：StrategyVersion 回测中心；`/validation` 与 `/research` 作为兼容路由保留。
- `/runs`、`/runs/:runId`：正式策略的自动选股研究批次和候选 Agent 运行只读回放入口；运行中心不提供独立的单标的执行入口。
- `/news`：实时新闻输入查看入口。

页面关系为 `Agent 中心 + 数据中心 → 策略中心 → 回测中心 → 运行中心`。侧边栏以用户任务为顺序，先显示策略工作台，再显示能力资产和验证运行。旧入口保留兼容跳转：`/` 到 `/overview`，`/simulation` 与 `/runs/preview` 到 `/runs`，`/strategy-editor` 到策略中心（不会再跳转到硬编码策略）。

## 前端领域对象

`apps/dsa-web/src/types/strategy.ts` 定义了 Strategy、StrategyVersion、AgentTemplate、AgentInstance、AgentConnection、Run、Evidence、DecisionProposal 和 CandidateExperience 的边界。`api/strategyWorkspace.ts` 是临时的前端 Adapter；它提供已整理的策略和 Agent 模板，不代表真实市场数据、收益或执行结果。

## 诚实状态

数据源、策略持久化、运行时、模拟成交和验证指标尚未全部接入。相关页面必须显示“尚未连接”“暂无运行记录”或“未启用”，不得生成虚假新闻、模拟收益或真实交易指令。

## 后端接口方向

后续后端应提供策略/版本 CRUD、模板复制、静态图校验、数据源与授权、运行/Agent Run 记录、证据追踪、验证实验、候选经验审核、模拟账本和风险决策等接口。所有 Run 应保存策略版本、Agent 快照、Prompt/模型版本、数据快照、Evidence ID、经验集版本与最终决策提案。
## 策略定义与版本发布闭环（已实现）

`Strategy` 是可归档的策略身份；`StrategyVersion` 是完整定义。创建策略会在同一事务中创建一个 `DRAFT`。只有草稿可以修改；发布后版本变为 `PUBLISHED`、`immutable=true`，所有 Agent、连接、Prompt、风险规则和画布坐标均不可修改。

草稿通过一个完整保存事务提交策略元数据、Agent 和连接，并以 `revision` 乐观并发控制。冲突返回 `VERSION_CONFLICT`，服务不会覆盖服务器版本。发布再次运行唯一的 `StrategyGraphValidator`；错误阻止发布，警告需显式确认。发布以 `draft_id + idempotency_key` 去重，并在同一事务中分配正式版本号、冻结快照、更新当前正式版本和写入审计。

Agent 使用 `lineage_id` 作为跨版本稳定身份：从正式版本创建草稿时数据库 ID 会重新生成，但 lineage 保留，因此版本差异不依赖名称或瞬时 ID。运行、Evidence、Risk Engine、订单和账本仍不属于此阶段。

### 编辑器交互与模板

编辑器从 `simulation_agent_templates` 及其不可变版本读取策略 Agent 模板；新实例保存模板 ID 与版本，并在后续模板变更后保持不变。官方策略模板来自服务端既有 `simulation_templates.json` 目录，创建时由 Definition Service 事务化复制为独立草稿、Agent、连接和数据来源配置；当前官方起步链路为 **ANALYSIS → DECISION → REFLECTION**，ANALYSIS 到 DECISION 使用 `DATA_FLOW`，DECISION 到 REFLECTION 使用 `POST_RUN_CONTEXT`。数据不再建模为 Agent，而由同一 StrategyVersion 的 `dataPermissionSnapshot` 在运行前准备并冻结。模板卡不展示收益承诺。

数据来源配置采用“三个默认类型 + 其他目录”的结构：K 线、新闻、基本面默认启用，K 线不可关闭。研究市场是上游约束，数据目录项通过 `markets` 声明支持的 A 股、港股或美股范围；策略编辑器只展示兼容来源，服务端检查再次拒绝跨市场组合。每个默认类型都可以保留系统自动路由，也可以锁定目录中已配置的具体提供方；切换市场时不兼容的固定来源会回退到兼容自动路由，其他扩展来源会被移除。未配置凭据的渠道会展示为不可选，提供方选择和适用市场随 StrategyVersion 冻结。自动路由保留失败降级，指定提供方用于固定数据口径且不会跨同类来源静默切换。自定义 K 线、新闻、基本面和其他来源均由 `simulation_data_sources` 目录提供稳定标识、类型和市场标签。目录记录不保存 URL、Token 或密钥，也不把“已登记”或“已配置”伪装成远端健康；实际连接结果仍在运行时核对并留存来源证据。

连接属于策略版本，支持 `DATA_FLOW` 与 `POST_RUN_CONTEXT`。编辑器允许选择、修改受控 condition 和 JSON 字段映射、删除连接；没有任何表达式执行能力。正式版本可查看连接但不能修改。发布前的图校验仍是后端 `StrategyGraphValidator` 的唯一权威。

草稿冲突会暂停自动保存。用户可比较浏览器本地草稿与服务器草稿、明确加载服务器版本，或保留本地内容；系统不会用旧 revision 强制覆盖服务器。版本差异以 lineage 匹配 Agent，并以分类列表展示 Agent、Prompt（哈希）、连接和策略策略项变化。

### 本阶段未实现

正式版本现在可发起“自动扫描研究”：先读取版本冻结的 `dataPermissionSnapshot`、`marketScope` 与 `screeningPolicy`，调用已连接的 K 线选股服务形成候选和输入快照，再为每个候选创建独立、可追溯的 Agent 图研究运行。新版本按 ANALYSIS、DECISION 执行，最后才执行只读复盘的 REFLECTION；旧正式版本中的 INPUT Agent 仍按原始冻结图兼容运行。最终展示的是决策 Agent 的研究提案。运行中心在没有可用 LLM 渠道时会明确阻止新批次并提示在设置中配置模型，避免把不可能产生分析或决策的批次伪装为成功。

它不会创建订单、成交、持仓或收益；模型输出也只是研究结论，而不是可直接执行的买卖指令。

运行中心把已发布策略的研究执行分成两种明确模式：**运行一次**立即创建一批候选扫描与 Agent 研究；**持续运行**创建持久化控制记录，按用户选择的间隔重复创建新的研究批次。持续控制只有 `running`、`paused`、`terminated` 三种意图状态；暂停与终止会阻止下一轮，已经开始的批次会完成并保留可追溯记录。服务重启后会恢复仍为 `running` 的控制记录。该控制层不包含订单、风险放行、成交、持仓、账本、收益或自动交易能力。

运行中并非只在最后写入结果：选股完成后，候选及其子运行会立即出现；每个 Agent 的 `queued`、`running`、`completed` 或 `failed` 状态会写回该子运行快照。运行中心在活动批次期间每 2.5 秒刷新，候选详情每 2 秒刷新，因此可以看到当前执行到的 Agent 和完成/失败原因，而无需猜测后台状态。

“运行一次”使用进程内后台任务，不能跨服务重启恢复。应用启动时会把遗留的 `queued` / `running` 一次性批次明确标记为“服务重启导致中断”，用户可以重新提交；持续运行控制则仍会按其持久化状态恢复下一周期。

定时调度、Evidence/DataSnapshot、结构化 DecisionProposal、Risk Engine/RiskDecision、模拟成交、账本、反思执行和经验检索仍未实现，也不会由此页面伪装为可用。

### 本轮交互收口

草稿节点提供原生输入/输出连接点：根 ANALYSIS Agent 直接接收版本冻结的数据输入，其他 ANALYSIS 和 DECISION 按图规则连接，REFLECTION 只接收 `POST_RUN_CONTEXT`。用户从输出点拖至输入点创建连接；正式版本不显示可操作手柄。旧版 INPUT 模板仅为不可变历史版本兼容保留，不再出现在新策略的模板库中。

普通字段映射使用 Schema 驱动的逐行选择器，持久化格式仍为 `{ "source.path": "target.path" }`。界面显示字段类型、描述和 required，并提示重复目标字段或显著类型不兼容；不执行 JavaScript、Python 或其他表达式。

冲突本地分叉创建全新的 Strategy/Draft、Agent 数据库 ID 和 lineage，不覆盖源草稿。版本记录以 `fromVersion`、`toVersion` URL 参数保存双版本选择。
