# 测试说明

[功能与执行逻辑](website-functional-logic.md) 描述功能覆盖面。以下命令验证当前实现，执行记录中的实际退出码才是通过证据。测试环境使用 `requirements.txt` 与 `.github/requirements-ci.txt`；不要连接生产数据库或复用生产凭证。

## 后端

```bash
./scripts/ci_gate.sh
python -m pytest -m network
python scripts/check_ai_assets.py
```

`ci_gate.sh` 执行 Python 语法、关键 flake8 规则与非网络完整套件。网络测试单列；缺少凭证的 skip 不能解释为供应商通过。真实模型、SMTP、通知投递及部署代理需另做目标环境验收，不由构建或 mock 证明。

## Web 与隔离浏览器

在 `apps/dsa-web` 运行：

```bash
npm ci
npm test -- --maxWorkers=2
npm run lint
npm run build
npx playwright install --with-deps chromium
export DSA_STRATEGY_E2E=1
export DSA_WEB_SMOKE_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")"
npm run test:smoke -- --workers=1 --retries=0
```

隔离模式创建独立 SQLite、随机运行标识和测试登录凭证，调用真实认证/API；`e2e.env` 使用现有 `ADMIN_ACCESS_MODE=legacy` 强制登录，以及 `WEBUI_AUTO_BUILD=false` 防止后端启动同时重装 Vite 的依赖。它不改变生产默认模式。`.artifacts/strategy-definition-e2e/` 含私有测试文件，不提交或公开上传。

默认使用 Playwright Chromium。已有 Chrome 的本机可临时设置 `DSA_PLAYWRIGHT_CHANNEL=chrome`；该变量只选择测试浏览器，CI 仍安装 Chromium。不要为评测写死系统浏览器路径。正式场景重试为零，单线程共享隔离库；单元测试用两 worker 降低资源争用。

## 桌面与容器

桌面在 `apps/dsa-desktop` 执行 `npm ci`、`npm test`。完整 macOS 构建先运行 `PYTHON_BIN=<测试环境 Python> bash scripts/build-backend-macos.sh`，再执行 `npm run build -- --mac`；该后端脚本同时构建 Web、检查冻结依赖与静态资源。Windows 使用现有对应打包脚本，不能以 macOS 构建替代。

容器使用 `docker build -f docker/Dockerfile -t ai-stock-evaluation .`；再在镜像内做关键模块导入检查。Compose 的 `server` 健康检查请求实际 `API_PORT` 的 `/api/health`，HTTP 失败必须返回非零；默认定时分析器不启动 HTTP，不使用该检查。无 Docker/daemon 的环境必须列为未验证。

## 策略接口与手动工作流

现有 `scripts/smoke_strategy_definition.py <隔离 API 地址>` 可检查定义与发布 HTTP 接口。它会创建 `smoke-` 数据，不调用 Agent 或执行交易，应仅用于隔离服务。历史编辑器页面已跳转，不能用旧页面选择器验证当前 UI。

当前 `.github/workflows/strategy-definition-acceptance.yml` 复用治理、后端门禁、完整 Web、认证浏览器 smoke 与 Docker 构建/导入，失败日志始终上传。详情见 [策略定义验收](strategy-definition-acceptance.md)。不存在旧的 `verify_strategy_definition_acceptance.py --full` 入口或 `--stage` 模式，不应再使用。
