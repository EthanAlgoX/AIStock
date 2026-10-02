# 策略定义与项目验收

当前可执行入口是 `.github/workflows/strategy-definition-acceptance.yml` 的 `workflow_dispatch`，而不是已删除的专用验收脚本。该工作流复用既有门禁；策略定义与版本发布的行为由后端测试覆盖，当前网站使用投研助理、选股、模拟账户及任务成果入口。

## 工作流实际步骤

1. 安装现有 Python/Web 依赖及 Chromium，执行 `scripts/check_ai_assets.py`。
2. 执行 `scripts/ci_gate.sh`：语法、关键 flake8、完整离线 pytest。
3. 完整 Web 单元测试（两 worker）、lint 和 build。
4. `DSA_STRATEGY_E2E=1` 启动隔离 API、Vite 与 SQLite，用随机凭证执行真实认证/页面 smoke，单 worker、零重试。
5. 使用 `docker/Dockerfile` 构建镜像，在镜像内导入 API、数据、Agent 依赖与选股等关键模块。
6. 无论成功失败，都上传 `.artifacts/strategy-definition-acceptance/` 的日志及浏览器输出。所有带 `tee` 的步骤启用 `pipefail`，不掩盖失败退出码。

流程不上传隔离数据库、凭证文件或生产配置；验收截图及录屏属于 Actions artifact，不应合入仓库。容器阶段只检查构建与运行时导入，**没有**启动 Compose 或执行容器 HTTP 生命周期 smoke，不能宣称这部分已覆盖。

## 本机复现与契约

具体命令见 [测试说明](testing.md)。现有 `scripts/smoke_strategy_definition.py <隔离 API 地址>` 检查定义/发布接口，创建 `smoke-` 数据但不执行模型或交易。定义测试覆盖图连接、字段映射、草稿 revision 冲突、发布不可变性、幂等与版本差异。持续研究、计划领取、私有工作区恢复和模拟账本另由对应服务测试覆盖，不能从“发布成功”推断已执行或已成交。

浏览器配置用当前页面的 role/label 定位，历史策略编辑器路由已兼容跳转。报告 smoke 使用隔离库中的已保存报告，不调用真实 LLM 或通知渠道。测试环境可用 `DSA_PLAYWRIGHT_CHANNEL=chrome` 选择已安装 Chrome，CI 默认 Chromium。

## 通过条件与缺口

每次交付记录实际执行命令、结果、环境与未验证项。历史测试数量、旧脚本的 `summary.json`、删除页面的截图均不是当前 head 的验收证据。不得以重试成功替代修复确定性问题，也不得把缺失 Docker、Windows 打包或供应商凭证列为通过。

该手动工作流不自动发布、推送、打 tag 或执行实盘；真实模型/SMTP、全部行情源、公网 HTTPS/代理与备份恢复需在实际部署环境单独验证。执行语义见 [策略定义与研究架构](strategy-architecture.md) 和 [网站功能与执行逻辑](website-functional-logic.md)。
