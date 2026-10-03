# 测试说明

[功能与执行逻辑](website-functional-logic.md) 描述功能覆盖面。以下命令验证当前实现，执行记录中的实际退出码才是通过证据。测试环境使用 `requirements.txt` 与 `.github/requirements-ci.txt`；不要连接生产数据库或复用生产凭证。

## 按 README 验收功能

先在独立目录、配置和数据库中依次执行 README 的安装、Web 构建、`--serve-only` 启动与 `/api/health` 检查。空模型配置允许服务打开，但不代表 AI 分析已经可用。连接模型后，按下面的入口检查功能；每项分别记录真实入口结果、确定性集成结果和外部依赖情况。

| 功能入口 | 验收动作与预期 | 外部依赖与失败路径 |
| --- | --- | --- |
| 投研助理 | 新建对话、选择 Skill、提问、追问、重开历史；回答与方法选择保存；检查语言与主题切换 | 需可用模型与启用工具；失败应有原因，切换身份后旧回答不能回填 |
| 专家圆桌 | 同主题分别运行流水线、辩论、投票；保存独立意见与汇总 | 需模型及专家能力；部分失败应明确，不补造专家发言 |
| 个股研究与档案 | 选市场与代码、审阅默认方法、运行、从历史及任务详情重新打开 | 自动准备内置研究配置；模型/行情不可用应失败或明确标记缺失，不能用旧报告冒充新结果 |
| 市场雷达 | 切换股票/加密市场，检查快照、资讯时间与复盘结果 | 行情、新闻和模型各自可失败；空资料与真实零值须区分 |
| 策略选股 | 执行已选规则，核对候选范围、排序、每项依据及历史 | 自然语言解读不能改写规则；缺 OHLC 的日线不能补造突破或形态证据 |
| 持仓与账户账本 | 新建账户、记入现金与交易、核对数量/成本/现金、归档和历史 | 数字以账本为准；账户不能跨用户读取，建议不能直接修改实际持仓 |
| 关注股与持仓跟踪 | 保存启用计划，确认没有立即运行；另行手动研究并查看评分历史 | 日历日跟踪与交易日模拟不同；JEV/LLM按选择执行，邮件须用户启用且平台配置可投递 |
| 交易推演 | 明确股票范围→预览确认→保存→选择规则回测/单次/持续模拟，核对日线、成交、费用、仓位和净值 | 保存不执行交易；首日仅形成下一日决策；缺价格、非法输出及入队失败应显式失败并可重试 |
| 停止、暂停及重启 | 暂停保留估值、停止后无新交易；修改配置不写旧账本；重启保留历史与未来计划 | 进程退出可中断在途任务；不能以重启自动重放已计费模型调用 |
| 定时任务与运行历史 | 创建/禁用/编辑/删除计划，检查到期领取、取消、成果和失败状态 | 服务器需持续运行；线程提交失败不能留下永久 queued 或占用租约 |
| 能力中心与模型设置 | 保存方法/专家、配置数据源/MCP、启停能力、检查权限与可用性 | 配置校验不是实际供应商连通证明；新绑定不能使用禁用能力，已批准方法按冻结快照执行，工具仍须权限校验；成员不能管理平台密钥 |
| 注册、个人 API 与用量 | 分别验受邀和无邀请码账户、私有工作区、个人密钥保存/移除、额度预扣结算；查看用量的调用次数、token、模型及时间范围；登出后验证登录与原路径恢复 | 个人 API 失败不回退平台；无邀请码无平台额度，真实 API 的认证、限流与计费另测 |
| 告警、通知与机器人 | 验证触发/冷却、通知路由、格式、命令解析及失败诊断 | 离线 transport 替代只能验证请求，不能证明邮件/消息已送达；真实投递须指定测试收件方 |
| CLI、桌面与部署 | CLI 参数/非分析模式、桌面启动及资源读取、容器健康检查、旧 URL 跳转 | macOS、Windows、Docker分别记录；只通过 Web 构建不能推断冻结后端资源可用 |

真实模型、JEV、SMTP、MCP 和行情供应商要按具体配置单列在线检查。固定响应或 HTTP transport 替代只验证编排、结构及记账；不能用于声称研究质量、实际投递或所有市场已联网通过。保留测试日志、退出码、隔离库与浏览器证据于临时目录或 Actions artifact，不把一次性截图合入仓库。

## 后端

```bash
python -m pip install -r .github/requirements-ci.txt
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
