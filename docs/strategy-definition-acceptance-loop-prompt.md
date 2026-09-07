# 策略定义闭环验收 Loop Prompt

将以下内容直接交给当前代码库的开发 Agent。

```text
你是一名资深 FastAPI、SQLAlchemy、React/TypeScript、Playwright、测试基础设施和 CI 工程师。请继续在当前 InvestCrew 代码库中直接实施。

本轮不是产品功能开发，也不是 Run / Evidence / Risk Runtime 阶段。唯一目标是完成“策略定义与版本发布闭环”的最终自动化验收，并给出机器可核验结果。

当前已经完成：

- Strategy / StrategyVersion / AgentTemplate / AgentInstance / AgentConnection / AuditEvent 持久化。
- Draft 保存、revision 并发控制、图校验、发布幂等、Published 不可变、基于版本创建 Draft、版本 Diff、fork-local。
- 策略编辑器 Handle 拖拽连接、fieldMapping、版本比较、冲突处理与只读状态。
- 隔离 Playwright 模式：独立 SQLite、ENV_FILE、Session Secret、一次性密码、正常认证登录、按 runId 派生端口、retries=0。
- 认证 E2E 已连续冷启动通过 10/10。
- `VERSION_CONFLICT` 的结构化 payload 已修复为可从 HTTP 错误处理中透传；编辑器能够读取服务器 revision 并暂停自动保存，双浏览器冲突 E2E 已验证。
- 已有 7 个专项前端测试文件，但目前仅 11 个测试，覆盖不足。
- 三条 Chromium E2E 已建立并以 `--stage e2e` 连续运行两轮：每轮 4 passed、0 failed、0 skipped、retries=0。该结果不是完整 `--full` 验收。
- 当前空白/官方模板策略尚不能仅通过 UI 补齐发布所需 riskPolicy，因此 Published 只读浏览器闭环尚未完成。
- 已有 scripts/verify_strategy_definition_acceptance.py 和手动 CI workflow：.github/workflows/strategy-definition-acceptance.yml。

严格冻结范围：

不得实现或扩展 Run Orchestrator、AgentRun、LLM 实际执行、Evidence、DataSnapshot、DecisionProposal Runtime、Risk Engine、RiskDecision、Paper Ledger、自动成交、反思执行、经验检索、定时任务、券商连接或真实交易。

先检查并复用：

- apps/dsa-web/playwright.config.ts
- apps/dsa-web/e2e/strategy-definition-auth.spec.ts
- apps/dsa-web/src/pages/StrategyEditorPage.tsx
- apps/dsa-web/src/pages/StrategyWorkspacePage.tsx
- apps/dsa-web/src/pages/strategyEditorUtils.ts
- apps/dsa-web/src/api/strategyWorkspace.ts
- scripts/verify_strategy_definition_acceptance.py
- scripts/smoke_strategy_definition.py
- tests/test_strategy_definition_service.py
- tests/test_strategy_graph_validator.py
- tests/test_intelligence_service.py
- .github/workflows/strategy-definition-acceptance.yml

第一步：补齐可发布的策略配置 UI（仅限已存在后端字段）

这是验收阻断项，不是扩展新策略业务。请检查已有 StrategyVersion 的 `riskPolicy`、`decisionPolicy`、`memoryPolicy`、`dataPermissionSnapshot` 和图校验必填规则。

1. 在当前策略编辑器中增加最小且可访问的“策略配置”面板，使用户可编辑已经持久化的配置字段，尤其是发布所需 `riskPolicy`。
2. 复用当前 Draft 完整保存 API；不得新建第二套接口、模型或状态管理。
3. Published 版本必须为真实只读：表单 `disabled/readOnly`、可访问语义与后端 immutable 拒绝都必须保持。
4. 为官方 Strategy Template 或空白策略提供真实可校验的默认风险配置，或者通过编辑器让用户明确配置；不得用前端假成功、绕过 Graph Validator 或 Mock 验证结果。
5. 添加最小回归测试，证明用户可从真实 UI 保存配置、通过校验、发布并打开 Published 只读版本。

第二步：保持并验证 E2E 隔离和认证

1. 不复用开发服务；E2E 每次必须有独立 runId、SQLite、ENV_FILE、Session Secret 和前后端端口。
2. 后端和前端统一使用 127.0.0.1；Vite API 代理必须指向当次 E2E 后端。
3. 不关闭认证，不新增认证绕过路由；使用正常 /api/v1/auth/login 获取 dsa_session Cookie。
4. 保留并验证认证 Smoke：登录响应 200、Cookie 存在、受保护 API 200、受保护页面可访问。
5. 若 E2E 失败，先读取 artifacts 下的 backend.log、frontend.log、trace、截图和 JUnit；从实际证据修复，不用 sleep、retry 或跳过掩盖。

第三步：将 7 个前端专项测试扩展为真实行为矩阵

以下文件必须保留并使用真实生产组件、生产 API Adapter、生产状态逻辑；不得复制测试专用编辑器，不得新增 skip/only/xfail：

- StrategyEditorConnections.test.ts：Handle 显示、连接类型推断、合法/非法连接、重复连接、保存、删除、错误边高亮、Published 禁止编辑。
- StrategyFieldMappingEditor.test.ts：Schema 展开、nested/array/required/description/enum/nullable、字段选择、兼容性、重复映射、对象/行 round-trip、只读。
- StrategyConflictResolution.test.tsx：409、CONFLICT、暂停自动保存、本地内容保留、diff-preview、加载服务器确认与恢复、无 force overwrite。
- StrategyForkLocalDialog.test.tsx：默认名称、数量、完整 payload、无 owner/status 字段、防双击、成功跳转、失败保留、权限错误、幂等重试。
- StrategyVersionCompare.test.tsx：Draft/Published 默认选择、切换、交换、URL 恢复、Agent/Connection/Mapping/Prompt/Policy Diff、Prompt 脱敏、空态、重试。
- StrategyEditorAutosave.test.tsx：CLEAN→DIRTY→SAVING→SAVED、revision 更新、失败、单一在途保存、后续保存、新 revision、CONFLICT、validation outdated、离开提示、timer 清理。
- StrategyEditorReadOnly.test.tsx：Published 下 Agent、Prompt、模型、Schema、Connection、Mapping、Policy 不可修改；仍可查看 Diff/Audit 并创建新 Draft。

目标为至少 60 个有意义的行为测试，而不是无意义快照或纯存在断言。现有 11 条测试只能作为起点，不能将纯工具函数断言包装成完整组件覆盖。

第四步：完成并强化三条真实 Chromium E2E

每条 E2E 必须独立、使用真实 Chromium、retries=0、独立 SQLite。核心交互必须通过浏览器 UI；不得用 API 创建 Connection 代替真实 Handle 拖拽。

1. strategy-editor-flow.spec.ts
   - 正常认证后创建策略或从策略模板复制。
   - 从真实 Agent Template 添加 INPUT、ANALYSIS、DECISION、REFLECTION。
   - 用 Playwright mouse 通过 Handle boundingBox 拖拽 INPUT→ANALYSIS、ANALYSIS→DECISION、DECISION→REFLECTION。
   - 验证 DATA_FLOW、POST_RUN_CONTEXT 和非法 REFLECTION→ANALYSIS 被拒绝。
   - 用字段选择器配置 fieldMapping，等待 save-status 显示已保存。
   - 刷新后验证 Agent、Connection、Mapping 恢复。
   - 使用新的策略配置面板补齐风险策略，调用真实后端校验并发布。
   - 发布并验证 Published 只读：策略配置、Agent、Prompt、Connection 与 Mapping 均不可修改，但可查看。

2. strategy-version-compare.spec.ts
   - 创建并发布基准版本，基于它创建 Draft。
   - 修改 Prompt、fieldMapping 和一条合法 Connection。
   - 使用双版本选择器比较 Published 与 Draft。
   - 验证 fromVersion/toVersion URL、刷新恢复、Prompt/Mapping/Connection 分类 Diff、交换方向和无差异空态。

3. strategy-revision-conflict.spec.ts
   - 两个独立 Browser Context 加载同一 Draft。
   - Page A 保存，Page B 使用旧 revision 保存，必须获得真实 409 VERSION_CONFLICT。
   - 验证冲突弹窗、本地内容、diff-preview、自动保存暂停。
   - 通过 UI 执行 fork-local，验证新 Strategy/Draft、Agent DB ID 与 lineage_id 重新生成、Connection/Mapping 重建、原 Draft 未被覆盖、审计事件存在。

不使用固定长 sleep；使用 waitForResponse、expect.poll、DOM、save-status 和 URL 条件。

第五步：完善唯一验收脚本

继续修改 scripts/verify_strategy_definition_acceptance.py，不要建立第二套完整验收脚本。

要求：

1. 支持 --stage e2e-auth / e2e / frontend / python / docker 和 --full。
2. 每次生成 .artifacts/strategy-definition-acceptance/<UTC timestamp>/。
3. 保存命令、完整 stdout/stderr、JUnit XML、summary.json 和 latest.json。
4. summary 必须从 JUnit 和子进程退出码解析，不得手工填写数字。
5. fail-open 目标测试运行 30 个独立 pytest 进程，生成 intelligence-fail-open-30x.json。
6. 两次完整 Python 测试必须使用 CI 对应的 marker/timeout 参数、独立 Python 进程和独立 TMPDIR，均生成 JUnit。
7. E2E 连续两次，每次新 SQLite、retries=0、JUnit 与日志齐全。
8. Docker 阶段必须实际执行 Docker build、Compose 启动、健康检查及 `scripts/smoke_strategy_definition.py`；不得仅构建镜像就记为通过。
9. 任一关键阶段失败时，summary.status=failed 且脚本非零退出。

第六步：执行正式验收

严格按如下顺序，任一失败先修复根因，再从对应验收起点重新执行：

1. Auth Smoke 单服务 10/10，完整冷启动 3/3。
2. 7 个专项文件全量执行，零失败、无新增 skipped。
3. 三条 E2E 整套 Run 1，retries=0；新 SQLite 下 Run 2，retries=0。
4. fail-open 目标测试 30/30；完整 tests/test_intelligence_service.py 零失败。
5. 完整 Python CI 等价测试 Run 1 和 Run 2，均 failed=0、errors=0、exit code=0、JUnit 存在。
6. 前端完整测试、npm run lint、npm run build、项目已有 typecheck、flake8、migration 测试、设计检测。
7. Docker 构建、启动、健康检查与 scripts/smoke_strategy_definition.py。
8. 最后从头执行：

   python scripts/verify_strategy_definition_acceptance.py --full

只有脚本退出码为 0 且最新 summary.json 的 status=passed，才可宣布完成。

第七步：CI 与文档

1. 保持 .github/workflows/strategy-definition-acceptance.yml 的 workflow_dispatch、Chromium 安装、--full 命令和 always 上传 artifacts。
2. 本地验证 workflow YAML；没有真实 GitHub Actions Run 时，不得声称 Hosted CI 已通过。
3. 更新 docs/strategy-definition-acceptance.md、docs/testing.md、docs/strategy-editor-ux.md、docs/CHANGELOG.md。
4. 文档必须区分真实完成、当前验证结果与尚未开始的 Runtime 范围。

当前明确阻断项：

- 7 个专项测试仍只有 11 条，必须扩展到至少约 60 个真实行为测试。
- UI 尚不能补齐发布必需的风险策略，导致完整 Published 只读 E2E 无法形成闭环。
- 尚未执行完整 `--full`：两次完整 Python、30 次 fail-open、前端全量、Docker 启动/健康/API smoke 均缺少真实 artifacts。
- Workflow 仅做过 YAML 解析，未取得 GitHub Hosted Actions Run；不得声称远程 CI 已通过。

最终回复必须报告：

- 认证/生命周期根因与修复证据。
- 7 个专项文件各自测试数及总结果。
- 三条 E2E 文件、Run 1/Run 2 的 scenarios、passed、failed、skipped、retries、JUnit、日志。
- fail-open 30 次与 Intelligence 文件结果。
- Python Full Run 1/2 的完整命令、collected、passed、failed、errors、skipped、exit code、JUnit、日志。
- 前端完整测试、lint、build、typecheck、flake8、migration、设计检测、Docker smoke 结果。
- 验收脚本命令、退出码、summary.json 与 latest.json 实际路径和 status。
- CI workflow 文件、YAML 检查结果，以及是否真的有远程 Actions Run。
- 仍未完成项。

严禁：skip/xfail/rerun、Playwright retry 掩盖失败、关闭认证、生产认证后门、开发数据库/开发服务复用、API 代替浏览器拖拽、虚构 JUnit 或 summary、提前进入 Runtime 开发。

只有所有项目实际通过后，才可以明确写：

“策略定义与版本发布闭环已通过完整验收，可以进入 Run / Evidence / Risk Runtime 阶段。”
```
