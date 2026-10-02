# 策略定义与研究执行架构

AI Stock 将交易策略视为第一对象。策略不是单一 Prompt 或独立 Agent，而是由多个 Agent Instance、数据授权、决策规则、风险边界、经验集合、版本和运行记录构成的可验证配置。

## 当前入口与历史边界

当前 `/overview` 是投研助理，`/screening` 是策略选股，`/trading` 是策略账户与模拟运行，`/runs`、`/runs/:runId` 展示任务与成果。方法、工具、数据源与专家由 `/capabilities/*` 管理。`/strategies/*`、`/strategy-editor`、`/backtests` 已跳转投研助理，`/agents` 跳转专家能力中心，`/data` 跳转数据能力中心；完整当前页面见 [网站功能与执行逻辑](website-functional-logic.md)。

下文描述仍保留的策略定义、正式 Agent 图研究及其 API 兼容契约。编辑器交互是历史产品设计，不代表当前路由仍开放该编辑器。策略账户的历史回放、持续模拟成交与净值账本是另一执行路径，见 [策略验证与运行](strategy-portfolios.md)，不要将定义发布或研究批次视为已成交。

## 前端领域对象

`apps/dsa-web/src/types/strategy.ts` 定义策略与研究图领域对象；`apps/dsa-web/src/api/strategyWorkspace.ts` 调用现有后端接口。策略定义、发布、研究与持续控制分别由 `src/services/strategy_*` 服务持久化；模板元数据不代表真实市场收益或执行结果。

## 诚实状态

状态以对应服务的实际记录为准。没有来源、成果、运行或账户账本时显示缺失/失败，不能从保存配置推断模型执行成功，也不能从模型提案推断模拟成交。

打包桌面端包含官方模板和内置可信 Python 内核的源文件及模块；上传的 Python 内核需要源码部署的独立解释器。冻结后端不充当通用 Python，执行上传内核返回 `STRATEGY_KERNEL_RUNTIME_UNSUPPORTED`，而不是以包已校验或版本已保存推断运行环境可执行。详见 [桌面打包](desktop-package.md)。

## 策略定义与版本发布闭环（已实现）

`Strategy` 是可归档的策略身份；`StrategyVersion` 是完整定义。创建策略会在同一事务中创建一个 `DRAFT`。只有草稿可以修改；发布后版本变为 `PUBLISHED`、`immutable=true`，所有 Agent、连接、Prompt、风险规则和画布坐标均不可修改。

草稿通过一个完整保存事务提交策略元数据、Agent 和连接，并以 `revision` 乐观并发控制。冲突返回 `VERSION_CONFLICT`，服务不会覆盖服务器版本。发布再次运行唯一的 `StrategyGraphValidator`；错误阻止发布，警告需显式确认。发布以 `draft_id + idempotency_key` 去重，并在同一事务中分配正式版本号、冻结快照、更新当前正式版本和写入审计。

Agent 使用 `lineage_id` 作为跨版本稳定身份：从正式版本创建草稿时数据库 ID 会重新生成，但 lineage 保留，因此版本差异不依赖名称或瞬时 ID。运行、Evidence、Risk Engine、订单和账本仍不属于此阶段。

### 编辑器交互与模板

编辑器从 `simulation_agent_templates` 及其不可变版本读取策略 Agent 模板；新实例保存模板 ID 与版本，并在后续模板变更后保持不变。官方策略模板来自服务端既有 `simulation_templates.json` 目录，创建时由 Definition Service 事务化复制为独立草稿、Agent、连接和数据来源配置；当前官方起步链路为 **ANALYSIS → DECISION → REFLECTION**，ANALYSIS 到 DECISION 使用 `DATA_FLOW`，DECISION 到 REFLECTION 使用 `POST_RUN_CONTEXT`。数据不再建模为 Agent，而由同一 StrategyVersion 的 `dataPermissionSnapshot` 在运行前准备并冻结。模板卡不展示收益承诺。

数据来源配置采用“三个默认类型 + 其他目录”的结构：K 线、新闻、基本面默认启用，K 线不可关闭。研究市场是上游约束，数据目录项通过 `markets` 声明支持的 A 股、港股或美股范围；策略编辑器只展示兼容来源，服务端检查再次拒绝跨市场组合。每个默认类型都可以保留系统自动路由，也可以锁定目录中已配置的具体提供方；切换市场时不兼容的固定来源会回退到兼容自动路由，其他扩展来源会被移除。未配置凭据的渠道会展示为不可选，提供方选择和适用市场随 StrategyVersion 冻结。自动路由保留失败降级，指定提供方用于固定数据口径且不会跨同类来源静默切换。自定义 K 线、新闻、基本面和其他来源均由 `simulation_data_sources` 目录提供稳定标识、类型和市场标签。目录记录不保存 URL、Token 或密钥，也不把“已登记”或“已配置”伪装成远端健康；实际连接结果仍在运行时核对并留存来源证据。

连接属于策略版本，支持 `DATA_FLOW` 与 `POST_RUN_CONTEXT`。编辑器允许选择、修改受控 condition 和 JSON 字段映射、删除连接；没有任何表达式执行能力。正式版本可查看连接但不能修改。发布前的图校验仍是后端 `StrategyGraphValidator` 的唯一权威。

草稿冲突会暂停自动保存。用户可比较浏览器本地草稿与服务器草稿、明确加载服务器版本，或保留本地内容；系统不会用旧 revision 强制覆盖服务器。版本差异以 lineage 匹配 Agent，并以分类列表展示 Agent、Prompt（哈希）、连接和策略策略项变化。

### 正式图研究与持续控制

正式版本现在可发起“自动扫描研究”：先读取版本冻结的 `dataPermissionSnapshot`、`marketScope` 与 `screeningPolicy`，调用已连接的 K 线选股服务形成候选和输入快照，再为每个候选创建独立、可追溯的 Agent 图研究运行。新版本按 ANALYSIS、DECISION 执行，最后才执行只读复盘的 REFLECTION；旧正式版本中的 INPUT Agent 仍按原始冻结图兼容运行。最终展示的是决策 Agent 的研究提案。运行中心在没有可用 LLM 渠道时会明确阻止新批次并提示在设置中配置模型，避免把不可能产生分析或决策的批次伪装为成功。

它不会创建订单、成交、持仓或收益；模型输出也只是研究结论，而不是可直接执行的买卖指令。

运行中心把已发布策略的研究执行分成两种明确模式：**运行一次**立即创建一批候选扫描与 Agent 研究；**持续运行**创建持久化控制记录，按用户选择的间隔重复创建新的研究批次。持续控制只有 `running`、`paused`、`terminated` 三种意图状态；暂停与终止会阻止下一轮，已经开始的批次会完成并保留可追溯记录。服务重启后会恢复仍为 `running` 的控制记录。该控制层不包含订单、风险放行、成交、持仓、账本、收益或自动交易能力。

进程关闭先停止创建任务的轮询器，再停止所有工作区持续控制器。已开始的批次仍绑定原数据库完成；恢复后的下一轮及成员数据库重新打开后的执行必须等待同一控制的在途批次，不能产生重叠研究或写入另一用户数据库。数据库与 control ID 共同定义归属，不同工作区的同名 ID 互不阻塞。成员维护也会恢复持久化运行控制，并将中断的一次性批次明确记为失败。

运行中并非只在最后写入结果：选股完成后，候选及其子运行会立即出现；每个 Agent 的 `queued`、`running`、`completed` 或 `failed` 状态会写回该子运行快照。运行中心在活动批次期间每 2.5 秒刷新，候选详情每 2 秒刷新，因此可以看到当前执行到的 Agent 和完成/失败原因，而无需猜测后台状态。

“运行一次”使用进程内后台任务，不能跨服务重启恢复。应用启动时会把遗留的 `queued` / `running` 一次性批次明确标记为“服务重启导致中断”，用户可以重新提交；持续运行控制则仍会按其持久化状态恢复下一周期。

正式图研究不会生成账户级订单审批、模拟成交或账户净值，也不提供完整经验检索闭环。共享工作区已有定时任务、数据快照和成果账本；策略账户已有独立模拟执行与每日账本，这些能力不能归为图研究批次的成交。

### 本轮交互收口

草稿节点提供原生输入/输出连接点：根 ANALYSIS Agent 直接接收版本冻结的数据输入，其他 ANALYSIS 和 DECISION 按图规则连接，REFLECTION 只接收 `POST_RUN_CONTEXT`。用户从输出点拖至输入点创建连接；正式版本不显示可操作手柄。旧版 INPUT 模板仅为不可变历史版本兼容保留，不再出现在新策略的模板库中。

普通字段映射使用 Schema 驱动的逐行选择器，持久化格式仍为 `{ "source.path": "target.path" }`。界面显示字段类型、描述和 required，并提示重复目标字段或显著类型不兼容；不执行 JavaScript、Python 或其他表达式。

冲突本地分叉创建全新的 Strategy/Draft、Agent 数据库 ID 和 lineage，不覆盖源草稿。版本记录以 `fromVersion`、`toVersion` URL 参数保存双版本选择。
