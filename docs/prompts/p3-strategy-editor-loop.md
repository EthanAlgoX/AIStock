# P3 开发 Loop Prompt：策略编辑与版本治理

你正在开发 InvestCrew 的“策略实验室”P3 阶段。先阅读：

- `docs/strategy-lab-roadmap.md`
- `docs/simulation-trading.md`
- `PRODUCT.md`
- `apps/dsa-web/src/pages/SimulationTradingPage.tsx`
- `api/v1/endpoints/simulation.py`
- `src/services/simulation_strategy_service.py`

## 目标

把当前“选择官方模板并记录预览运行”的页面，升级为“复制模板后可编辑并保存个人策略版本”的工作台。

用户不应从空白多 Agent 系统开始搭建。默认路径必须是：选择官方模板 → 查看继承资产 → 调整少量配置 → 保存为个人策略新版本。

## 已完成能力：必须复用，不要重做

- 官方策略模板：趋势突破、回踩质量、题材催化、质量价值、超跌修复、红利防御。
- 原项目资产：`strategies/*.yaml` 中的 16 个分析 Skill；`src/services/screening/strategies/*.yaml` 中的 10 个选股策略；`AgentOrchestrator` 的 `quick`、`standard`、`full`、`specialist` 四种编排。
- 后端隔离模型和 API：策略定义、不可变版本、`queued` 模拟运行。
- 现有路由：`/api/v1/simulation/strategies`、`/api/v1/simulation/strategies/{id}/versions`、`/api/v1/simulation/runs`。
- 当前模拟交易页面必须保持默认侧边栏入口，且不受 `SCREENING_ENABLED` 控制。

## 本轮交付范围

### 1. 策略编辑器（前端）

在 `/simulation` 提供渐进展开的编辑区，而不是一开始展示大量表单。

- 显示当前模板的来源资产：选股策略、分析 Skill、编排模式、默认风险边界。
- “复制并编辑”创建用户策略草稿；官方模板本身不可被覆盖。
- 可编辑字段：策略名称、描述、输入数据源开关、选股策略、分析 Skill 列表、编排模式、各 Agent 的 system prompt、风险规则、仓位规则。
- 必须提供保存与取消/恢复模板两种明确操作。
- 保存时创建不可变的新版本；页面提示新版本号和保存时间。
- 编辑状态、保存中、保存失败、无变更、保存成功都需要真实且可访问的反馈（`aria-live`）。

### 2. 版本治理（后端）

在现有 simulation API 上最小扩展，优先保留现有响应兼容性。

- 支持读取单个策略及其版本列表、读取某个版本的完整配置。
- 策略定义可以更新名称、描述、启用状态；版本配置始终不可修改。
- 为版本增加清晰的来源元数据：`template_id`、继承的选股策略 ID、Skill ID、编排模式、Prompt 快照、风险规则、仓位规则。
- 对 JSON 配置执行类型和尺寸校验；拒绝无法序列化或过大的配置。
- 所有数据仍与 portfolio、alerts、backtest、真实交易完全隔离。

### 3. 官方模板真源

不要把模板长期只维护在 React 常量中。建立一个后端可读取的模板目录（可以是受版本控制的 JSON/YAML 清单），至少包含：

- 稳定 template id、名称、描述、类别；
- 选股策略 ID；
- 分析 Skill ID；
- 编排模式；
- 默认 Prompt、风险规则、仓位规则；
- 原项目来源文件路径；
- 推荐输入数据源。

前端从模板 API 读取目录。模板元数据是“来源与建议”，不是策略有效性的证明。

## 非目标与硬约束

- 不调用真实券商，不创建真实订单，不读取或写入真实持仓。
- 不在本轮生成模拟订单、持仓、净值或收益；这些属于 P5。
- 不把 `queued` 或保存成功表述为“Agent 已运行”或“策略有效”。真正运行属于 P4。
- 不修改既有单股分析、选股、回测、告警页面的行为。
- 不删除用户已有数据；数据库迁移必须兼容已有 SQLite 数据库。
- 新用户可见能力必须更新 `docs/simulation-trading.md`、`docs/strategy-lab-roadmap.md` 和 `docs/CHANGELOG.md`。
- 使用 Docker 服务进行启动与验证，不启动本地服务。

## 验收标准

1. 用户可以从一个官方模板创建个人策略，编辑后保存为 v1；再次修改保存为 v2。
2. 打开 v1 时仍能看到 v1 的完整原始配置，v2 不会覆盖它。
3. 官方模板可被读取和复制，但不可被用户编辑覆盖。
4. 模拟运行创建时明确关联某个策略版本 ID。
5. 页面在桌面和移动端均可操作；保存状态、错误和成功结果对屏幕阅读器可播报。
6. 前端运行 `npm run lint`、`npm run build`；修改的后端模块通过编译和针对性 API/持久化测试；Docker health check 正常。
7. 使用现有视觉 token、组件和深色工作台语言；不引入新的视觉体系。

## 完成时汇报

简洁说明：实现了哪些 API 和页面交互、模板目录的来源、验证命令与结果、Docker 部署状态，以及 P4 的唯一下一步（按已保存策略版本执行现有 Agent 编排）。
