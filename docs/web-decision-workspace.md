# Web Agent 决策工作台

Web 产品以主 Agent 为统一交互和任务编排层。主 Agent、个股分析、选股、交易、专家评审与定时计划共享同一套后端能力注册表、任务合同、数据上下文快照、运行账本和成果对象；页面只是不同任务工作台，不代表不同 Runtime。

## 信息架构

核心工作台按投资决策顺序排列：

- `/overview`：主 Agent 对话；
- `/market-intelligence`：市场情报；
- `/stock-research`：结构化个股分析；
- `/screening`：结构化选股；
- `/trading`：交易策略配置与模拟提案运行。

辅助入口包括：

- `/expert-review`：单专家或用户指定成员的专家团评审；
- `/schedules`：个股、选股和交易任务的持久化定时计划；
- `/runs`：统一 Task / Run / DataSnapshot / Artifact 账本；
- `/capabilities/*`：Skill、内置 Tool、MCP、数据源和专家配置；
- `/settings`：模型、主 Agent Runtime、认证和系统配置。

旧上传策略、策略实验室和独立回测页面不再属于当前主产品链。历史 URL 只保留兼容跳转。

## 能力模型

工作区能力分为五类，并在后端分别治理：

| 类型 | 作用 | 运行边界 |
| --- | --- | --- |
| Skill | 金融研究或决策方法 | 作为版本化指令加入当前 Agent 任务 |
| Tool | 有输入 Schema 的站内查询或确定性计算 | 只发布金融 READ / COMPUTE 能力 |
| MCP | 外部 Server 的连接协议 | 健康的 HTTP MCP 可按任务挂载；stdio 仅由隔离 Runtime 启动 |
| 数据源 | 行情、新闻、基本面等事实来源 | 任务保存来源 ID，Run 冻结来源目录与时点 |
| 专家 / 专家团 | 同一 Agent Runtime 上的 Persona Prompt 与评审协议 | 每位专家独立运行，主 Agent 比较证据后汇总 |

能力中心保存工作区级启用范围，业务页保存任务级绑定。新会话和新任务会获得一组经过工作区白名单过滤的安全默认能力，用户仍可在提交前增删。MCP 必须先通过 HTTP 能力发现才可被业务任务选择；改动连接地址后必须重新探测。

## 任务与运行

后端统一管理以下对象：

- `Task`：研究、选股、交易或专家评审的可编辑定义；
- `DataSnapshot`：本次运行的数据来源 ID、目录状态和 `asOf` 时点；
- `Run`：手动或定时触发的一次执行，可排队、运行、取消、完成或失败；
- `Artifact`：`ResearchReport`、`ScreenSpec`、`CandidateList`、`ExpertReview`、`TradeProposal`、`RiskAssessment` 或 `PaperTradingRun`；
- `Schedule`：每日固定时间或分钟间隔计划。

每次 Run 都冻结任务版本与能力清单。服务重启时，无法恢复的排队或执行中任务会被明确标记失败，不会永久显示“运行中”。用户可以在 `/runs` 查看结果、错误和成果对象。

## 各工作台执行逻辑

### 主 Agent

`/overview` 使用流式 Agent API，支持会话、上下文、停止操作和任务级能力绑定。页面始终显示“主 Agent”，不会把底层引擎名称作为产品信息展示。工作区禁用的 Skill 和 Tool 不会再出现在可选目录或最终请求中。

### 个股分析

用户先选择市场和股票，再填写研究目标并挂载能力。任务必须绑定股票代码。运行完成后写入 `ResearchReport`，并保存数据时点、来源和能力快照。

### 选股

用户填写市场、行业、自然语言目标和候选数量。默认挂载 `screen_stock_universe` Tool；主 Agent 必须先调用现有确定性股票池筛选管线，再根据真实候选生成 `ScreenSpec` 与 `CandidateList`，不得凭语言补造未扫描股票。

### 专家评审

内置专家为巴菲特、芒格、段永平、凯西·伍德和张磊的公开投资框架，不冒充本人。用户可创建自定义 Persona 和专家团，并在群聊前指定实际成员。执行时各专家独立形成观点，主 Agent 依据证据质量、数据时点和假设强弱汇总，不采用简单多数投票。

### 交易

当前交易任务只允许 `paper`。Agent 生成 `TradeProposal`，后端只验证任务配置合同并明确记录尚未完成账户级提案风险评估；`PaperTradingRun` 不生成虚构成交、收益或真实订单。实盘执行、审批和账户级风险检查仍属于后续独立受控执行层。

### 定时任务

定时计划由后端持久化轮询器运行，不依赖浏览器保持打开。每日计划使用市场时区计算下一次执行；间隔计划支持 5 分钟至 7 天。停用或归档任务不能新建计划，归档任务会同步停用已有计划。

## 独立 Agent 引擎 适配

当 `AGENT_BACKEND=external_runtime` 时，网站通过独立 Agent 服务的 OpenAI-compatible SSE API 委托 Agent 回合，复用其 ReAct、会话、记忆和恢复能力。每轮请求必须携带 v1 能力隔离策略：独立 Agent 引擎只向模型暴露本轮精确授权的 Tool，并过滤未授权 Runtime Skill；网站发布的 `/api/v1/mcp` 在执行时还会校验短时签名授权、股票范围和数据源类别。旧 Runtime 未声明隔离协议时网站会拒绝执行，而不是降级为仅靠 Prompt 约束。

独立 Agent 引擎与网站职责保持分离：引擎负责 Agent 循环；网站负责任务合同、股票范围、工作区能力治理、运行账本、成果、风控和未来审批。网站不会执行用户登记的 stdio 命令，也不会把密钥值写入能力目录。

## 当前边界

- 数据快照目前冻结来源目录、可用状态与运行时点，不是底层供应商原始数据的完整不可变副本；
- 独立 Agent 引擎的 OpenAI-compatible 流不返回完整内部 Tool/MCP 轨迹，网站只能记录最终结果、能力策略 ID 和自身侧工具审计；
- 模拟交易当前停留在提案层，没有成交撮合、资金曲线和绩效归因；
- 自定义数据源登记的是已配置连接标识，具体适配器仍需由系统设置或后端服务提供。
- 数据源目录统一通过 `/api/v1/workspace/data-sources` 查询、登记和归档；旧 `/api/v1/simulation/definition/data-sources` 仅保留历史客户端兼容，不再由 Agent-first 页面直接调用。
