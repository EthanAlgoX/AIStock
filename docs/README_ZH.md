<div align="center">

<img src="../apps/dsa-web/public/tradebot-mark.svg" alt="InvestCrew" width="76" height="76">

# 投研团 · InvestCrew

**以 Agent 为核心的投研工作台：从一个问题，到一份有据可查的报告**

投研助理 · 专家圆桌 · 个股研究 · 策略选股 · 交易推演

[![CI](https://github.com/EthanAlgoX/InvestCrew/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanAlgoX/InvestCrew/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Agent_API-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

[English](../README.md) · **简体中文** · [繁體中文](README_CHT.md)

</div>

> InvestCrew 面向 A 股、港股和美股，提供研究与模拟交易实验能力。系统不会把模型输出包装成投资建议，也不允许 Agent 绕过确定性风控和执行边界。

项目原名 LLM TradeBot，现更名为「投研团 · InvestCrew」。GitHub 仓库已同步更名为 `EthanAlgoX/InvestCrew`。

## 从提问开始，让研究留下来

你可以向投研助理提出问题，邀请多位独立专家一起研究，也可以直接运行个股、选股或交易策略。InvestCrew 将 Agent 推理、Skill 方法、工具、MCP 与市场数据结合起来，形成可以回看、追问的研究成果。

- **对话为主。** 支持新建对话、历史会话，以及将近期对话中识别到的股票与可用分析方法组合起来的快捷问题。
- **专家按需参与。** 在输入框旁选择具体专家与协作方式；投研助理侧重最终报告，专家圆桌展示各方发言与协作过程。
- **报告优先阅读。** 个股研究、策略选股和交易推演以历史目录与报告阅读区为主体，发起新任务时再打开配置。
- **默认方案即可试用。** 根据已有自选股或固定演示标的，通过规则匹配可用策略与能力；运行前可以查看匹配依据，也可以自行调整。
- **任务后台执行。** 结构化任务启动后可切换页面，返回或刷新后恢复状态与成果；部分产出和失败原因明确保留。

## 六个相互衔接的工作区

网站默认打开**投研助理**。桌面主导航按下表排列；手机端的市场雷达放在工作区菜单中。

| 工作区 | 路由 | 主要用途 |
| --- | --- | --- |
| 市场雷达 | `/market-intelligence` | 查看市场快照、资讯、宏观观察与分析订阅 |
| 投研助理 | `/overview` | 日常问答、管理对话，按需邀请专家形成综合报告 |
| 专家圆桌 | `/expert-review` | 以持续群聊展示专家署名发言、相互回应与主持人总结 |
| 个股研究 | `/stock-research` | 运行研究策略，阅读结论、证据、风险和历史报告 |
| 策略选股 | `/screening` | 执行筛选规则，查看候选排名与入选依据，按需追加候选深研 |
| 交易推演 | `/trading` | 研究模拟交易提案、风险评估与信号后验表现 |

定时任务、运行记录、模型用量、系统设置与能力中心为各工作区提供支持。具体市场覆盖取决于策略与数据源；当前内置全市场筛选规则主要面向 A 股。

## 独立专家，三种协作方式

每位专家都是独立运行的 Agent，拥有自己的角色定义和允许使用的能力。主持人负责协调与汇总。用户直接选择专家，无需先创建命名小组。

| 模式 | 运作方式 |
| --- | --- |
| 流水线 | 主持人拆分任务，专家分别完成分工，并按需参考前序成果 |
| 辩论 | 专家独立形成观点，交叉质询与回应，再由主持人总结共识和未解决的分歧 |
| 投票 | 专家独立提交报告，由另外的评审 Agent 投票；主持人汇总计票与入选意见，或明确未选出结果 |

投研助理侧重最终报告；专家圆桌在群聊时间线中展示已完成的发言、协调、反驳与投票记录，支持在同一会话继续追问。这里展示的是已保存的协作消息，不是模型内部思考的实时输出。

## Agent 与策略如何配合

Agent 是统一交互与任务编排层；策略定义研究目标和执行约束，Skill 提供具体分析方法。正式研究与选股策略可以包含确定性的数据准备、代码计算和 LLM 分析，由 Agent 通过受控工具调用。

| 能力 | 负责内容 |
| --- | --- |
| **Skill** | 版本化的金融方法和任务指令 |
| **内置 Tool** | 具有输入 Schema 的确定性查询或计算 |
| **MCP** | 连接外部工具、资源和系统 |
| **数据源** | 行情、基本面、新闻等事实输入 |
| **专家 Agent** | 按独立角色进行分析、评审与协作 |

结构化运行会保存任务定义、能力选择、数据源上下文、状态与报告成果。运行记录将这些信息关联起来，区分“执行结束”和“成功产出、部分产出、空候选或任务受阻”。详细契约见[工作台架构说明](web-decision-workspace.md)。

## 安全与治理

- 工作区白名单和逐请求短时授权共同限制任务可用的 Skill、Tool、MCP、数据源、专家和股票范围。
- 内置 Tool 与 MCP 是两种不同能力，分别配置、发现和授权。
- 独立 Agent 引擎必须声明逐任务能力隔离；协议不兼容时系统会拒绝运行，不会静默降级。
- 网站负责任务、成果、审批、审计和交易边界。Agent 可以分析和提出建议，但不能绕过风控或创建真实订单。
- 密钥只保存在环境变量或受保护设置中，不会出现在能力目录和前端载荷里。

## 快速开始

环境要求：Python 3.10+、Node.js 20.19–26.x、npm 10+。以下命令适用于 macOS/Linux；Windows PowerShell 使用 `.venv\Scripts\Activate.ps1` 激活虚拟环境。

### 1. 安装并准备配置

```bash
git clone https://github.com/EthanAlgoX/InvestCrew.git InvestCrew
cd InvestCrew

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

已有 `.env` 时请保留原文件，对照示例补充配置，不要覆盖。开始分析前，在 `.env` 中配置模型服务，或启动网站后通过模型设置完成配置。例如使用 DeepSeek 时，启用并填写 `DEEPSEEK_API_KEY`；其他服务商与多渠道配置见[模型配置指南](LLM_CONFIG_GUIDE.md)。

默认 `AGENT_BACKEND=auto` 使用已配置的模型路由。Agent 任务需要可用且支持工具调用的模型，网站启动成功不代表分析已经可用。独立 Agent 引擎为可选接入，详见[运行引擎配置](agent-runtime-integration.md)。

### 2. 构建并启动

```bash
cd apps/dsa-web
npm ci
npm run build
cd ../..

python main.py --serve-only --host 127.0.0.1 --port 8000
```

启动后访问 Web 工作台 <http://127.0.0.1:8000>，API 文档位于 <http://127.0.0.1:8000/docs>。8000 为示例端口，被占用时可调整 `--port`。前端构建产物由 Python 服务提供。

### 3. 完成第一次分析

1. 在**设置**中检查模型可用性，在**能力中心**查看已启用的 Skill、专家与数据连接。
2. 直接向**投研助理**提问，或进入**个股研究**运行默认方案。默认方案仍需对应模型、正式策略与工具可用。
3. 阅读已保存的报告。想比较不同观点时，进入**专家圆桌**，选择专家与协作方式，提交讨论话题。

顶部提供中英文切换并保存语言偏好，主要工作区、研究配置、默认方案和报告控件跟随切换。历史报告正文、用户自定义名称与原始资讯保留原文；切换界面不会翻译或改写研究数据。

前端开发时，保持后端运行，在 `apps/dsa-web` 中执行 `npm run dev`。Vite 默认监听 <http://127.0.0.1:5173>，将 `/api` 代理到 8000 端口；后端地址不同时可配置 `DSA_WEB_API_PROXY_TARGET`。

## 开发验证

```bash
./scripts/ci_gate.sh

cd apps/dsa-web
npm run lint
npm run build
```

## 文档入口

- [文档索引](INDEX.md)
- [工作台交互与布局](workspace-ui.md)
- [Agent 决策工作台](web-decision-workspace.md)
- [主 Agent 独立运行引擎接入](agent-runtime-integration.md)
- [完整配置指南](full-guide.md)
- [部署指南](DEPLOY.md)
- [测试指南](testing.md)
- [更新记录](CHANGELOG.md)

## 许可证与免责声明

本项目采用 [MIT License](../LICENSE)，仅用于软件工程、投资研究以及受控的历史或模拟实验。研究报告、选股结果、交易提案和模型输出不保证未来表现，用户应自行承担投资决策与结果。
