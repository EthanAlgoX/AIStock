<div align="center">

<img src="../apps/dsa-web/public/tradebot-mark.svg" alt="LLM TradeBot" width="76" height="76">

# LLM TradeBot

**以 Agent 为核心的股票研究、选股与受控交易实验工作台**

主 Agent · 金融能力 · 结构化任务 · 可追溯运行

[![CI](https://github.com/EthanAlgoX/LLM-TradeBot/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanAlgoX/LLM-TradeBot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Agent_API-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

[English](../README.md) · **简体中文** · [繁體中文](README_CHT.md)

<br>

<img src="assets/readme/llm-tradebot-hero.jpg" alt="金融 Agent 编排经过治理的工具、数据与分析流程" width="100%">

</div>

> LLM TradeBot 面向 A 股、港股和美股，提供研究与模拟交易实验能力。系统不会把模型输出包装成投资建议，也不允许 Agent 绕过确定性风控和执行边界。

## 产品模型

主 Agent 是统一交互与任务编排层。用户先在工作区配置通用金融能力，再为每个任务挂载允许使用的子集；系统最终保存正式成果，而不只保留聊天文本。

| 能力 | 负责内容 |
| --- | --- |
| **Skill** | 版本化的金融方法和任务指令 |
| **内置 Tool** | 具有输入 Schema 的确定性查询或计算 |
| **MCP** | 连接外部工具、资源和系统 |
| **数据源** | 行情、基本面、新闻等事实输入 |
| **专家 / 专家团** | 基于 Persona 的独立评审和结构化讨论 |

每次结构化执行都会把任务定义和能力选择冻结到 `Run`，关联相应的 `DataSnapshot`，并保存一个或多个有类型的 `Artifact` 成果。

## 主要工作台

| 页面 | 路由 | 功能 |
| --- | --- | --- |
| 主 Agent | `/overview` | 通用对话、目标理解与能力编排 |
| 市场情报 | `/market-intelligence` | 使用已启用数据源生成可配置市场视图 |
| 个股分析 | `/stock-research` | 选择市场和股票、配置能力并生成研究报告 |
| 选股 | `/screening` | 定义选股目标并生成带证据的候选列表 |
| 交易 | `/trading` | 配置模拟策略并生成受控交易提案 |

专家评审、定时任务、任务与运行记录、模型用量和能力中心为上述五个决策工作台提供支持。旧上传策略和策略实验室不再属于主产品链路。

## 安全与治理

- 工作区白名单和逐请求短时授权共同限制任务可用的 Skill、Tool、MCP、数据源、专家和股票范围。
- 内置 Tool 与 MCP 是两种不同能力，分别配置、发现和授权。
- 独立 Agent 引擎必须声明逐任务能力隔离；协议不兼容时系统会拒绝运行，不会静默降级。
- 网站负责任务、成果、审批、审计和交易边界。Agent 可以分析和提出建议，但不能绕过风控或创建真实订单。
- 密钥只保存在环境变量或受保护设置中，不会出现在能力目录和前端载荷里。

## 快速开始

环境要求：Python 3.10+、Node.js 20.19+ 和 npm 10+。

```bash
git clone https://github.com/EthanAlgoX/LLM-TradeBot.git
cd LLM-TradeBot

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

cd apps/dsa-web
npm ci
npm run build
cd ../..

python main.py --serve-only --host 127.0.0.1 --port 8000
```

启动后访问 Web 工作台 <http://127.0.0.1:8000>，API 文档位于 <http://127.0.0.1:8000/docs>。

前端开发可在 `apps/dsa-web` 中运行 `npm run dev`。Vite 默认监听 <http://127.0.0.1:5173>，并将 `/api` 代理到 8000 端口。

## 开发验证

```bash
./scripts/ci_gate.sh

cd apps/dsa-web
npm run lint
npm run build
```

## 文档入口

- [文档索引](INDEX.md)
- [Agent 决策工作台](web-decision-workspace.md)
- [主 Agent 独立运行引擎接入](agent-runtime-integration.md)
- [完整配置指南](full-guide.md)
- [部署指南](DEPLOY.md)
- [测试指南](testing.md)

## 许可证与免责声明

本项目采用 [MIT License](../LICENSE)，仅用于软件工程、投资研究以及受控的历史或模拟实验。研究报告、选股结果、交易提案和模型输出不保证未来表现，用户应自行承担投资决策与结果。
