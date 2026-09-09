<div align="center">

<img src="apps/dsa-web/public/tradebot-mark.svg" alt="AI Stock" width="76" height="76">

# AI Stock

**Empower every stock trader with AI to become a one-person research powerhouse.**

Research assistant · Expert roundtable · Stock research · Strategy screening · Trade simulation

[![CI](https://github.com/EthanAlgoX/InvestCrew/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanAlgoX/InvestCrew/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Agent_API-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

**English** · [简体中文](docs/README_ZH.md) · [繁體中文](docs/README_CHT.md)

</div>

> AI Stock is a financial decision workspace for mainland China, Hong Kong, and US equities. It supports research and paper-trading experiments; it does not present model output as investment advice or bypass deterministic risk and execution controls.

Previously named LLM TradeBot and InvestCrew. The product is now AI Stock; the GitHub repository remains `EthanAlgoX/InvestCrew`. Clone it into an `AI-Stock` directory.

## Start with a question, keep the research

Ask a question in the Research assistant, invite independent experts to examine it, or run a focused research strategy. AI Stock combines Agent reasoning with Skills, tools, MCP connections, and market data to produce reports you can revisit and discuss.

- **Conversation first.** Create separate conversations, revisit history, and use suggested questions that combine available analysis methods with stocks recognized from recent conversations.
- **Optional expert collaboration.** Select individual experts and their collaboration mode beside the message composer. Use the assistant for the final report or the roundtable to follow each participant's contributions.
- **Reports first.** Stock research, screening, and trade simulation open around report history and a reading area. Configuration is available when starting a new task.
- **A ready-to-run starting point.** Default plans use configured watchlists or fixed demonstration stocks and match available strategies and capabilities through rules. Review the selection rationale or customize the plan before running.
- **Background execution.** Structured tasks continue when you change pages. Returning or refreshing restores their status and saved results; partial output and failures remain explicit.

## Six connected workspaces

The site opens in **Research assistant**. Desktop navigation follows the order below; mobile navigation places Market radar in the workspace menu.

| Workspace | Route | What you can do |
| --- | --- | --- |
| Market radar | `/market-intelligence` | Follow market snapshots, news, macro observations, and published analysis subscriptions |
| Research assistant | `/overview` | Ask questions, manage conversations, and optionally request an expert synthesis |
| Expert roundtable | `/expert-review` | Discuss a topic in a persistent group conversation with named expert messages and a moderator's summary |
| Stock research | `/stock-research` | Run a research strategy and read its conclusions, evidence, risks, and historical reports |
| Strategy screening | `/screening` | Apply screening rules, review ranked candidates and their rationale, and optionally research candidates further |
| Trade simulation | `/trading` | Explore paper-trading proposals, risk assessments, and signal evaluation results |

Schedules, run history, model usage, settings, and the Capability Center support these workspaces. Market coverage depends on the selected strategy and available data; built-in full-market screening rules currently target A-shares.

## Independent experts, three ways to collaborate

Each selected expert runs as an independent Agent with its own role and permitted capabilities. A moderator coordinates the work and synthesizes the results. You select experts directly, without having to create a named panel first.

| Mode | How it works |
| --- | --- |
| Pipeline | The moderator divides the task; experts complete their assigned parts, using earlier results where relevant |
| Debate | Experts form independent views, challenge one another, and respond before the moderator summarizes agreement and unresolved differences |
| Voting | Experts submit independent reports; separate reviewer Agents vote, and the moderator reports the tally and selected view, or an inconclusive outcome |

The assistant emphasizes the final report. The roundtable exposes completed contributions, coordination, rebuttals, and voting records in a group-chat timeline, with follow-up questions in the same conversation. These are saved messages, not a live display of private model reasoning.

## How Agents and strategies fit together

The Agent is the common interaction and orchestration layer. A strategy defines the research objective and execution constraints; Skills supply the analysis methods. Published research and screening strategies can combine deterministic data preparation and calculations with LLM analysis, and the Agent invokes them through governed tools.

| Capability | Responsibility |
| --- | --- |
| **Skill** | Versioned financial methods and task instructions |
| **Built-in Tool** | Schema-defined, deterministic read or compute operations |
| **MCP** | Connections to external tools, resources, and systems |
| **Data source** | Market, fundamental, news, and other factual inputs |
| **Expert Agent** | Independent role-specific analysis, review, and collaboration |

Structured executions save the task definition, selected capabilities, data-source context, status, and report artifacts. The run ledger connects these records so that a finished execution can be distinguished from a successful, partial, empty, or blocked research outcome. See the [workspace architecture](docs/web-decision-workspace.md) for the detailed contracts.

## Safety and governance

- Workspace allowlists and request-local grants restrict which Skills, Tools, MCP servers, data sources, experts, and stocks a task can use.
- Built-in Tools and MCP servers are separate capability types with separate configuration pages and permissions.
- Independent Agent execution must advertise task-capability isolation; unsupported runtimes fail closed.
- The website owns tasks, artifacts, approvals, audit records, and trading boundaries. The Agent may analyze and propose, but it cannot bypass risk checks or create live orders.
- Secrets remain in environment or protected settings and are never returned in capability catalogs.

## Quick start

Requirements: Python 3.10+, Node.js 20.19–26.x, and npm 10+. The commands below use a macOS/Linux shell; on Windows PowerShell, activate the environment with `.venv\Scripts\Activate.ps1`.

### 1. Install and prepare configuration

```bash
git clone https://github.com/EthanAlgoX/InvestCrew.git AI-Stock
cd AI-Stock

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

If you already have a `.env`, keep it and compare it with the example rather than copying over it. Configure a model provider in `.env` before running analysis, or use the website's model settings after startup. For example, enable and fill `DEEPSEEK_API_KEY` for DeepSeek; provider-specific and multi-channel options are documented in the [configuration guide](docs/LLM_CONFIG_GUIDE.md) (Chinese).

The default `AGENT_BACKEND=auto` uses the configured model route. Agent tasks need a working tool-calling model; starting the Web server alone does not make analysis available. A separate Agent runtime is optional: see [runtime integration](docs/agent-runtime-integration_EN.md).

### 2. Build and launch

```bash
cd apps/dsa-web
npm ci
npm run build
cd ../..

python main.py --serve-only --host 127.0.0.1 --port 8000
```

Open the Web workspace at <http://127.0.0.1:8000> and API documentation at <http://127.0.0.1:8000/docs>. Port 8000 is an example; change `--port` if it is occupied. The Web build is served by the Python application.

### 3. Run your first analysis

1. Check model availability in **Settings** and enabled Skills, experts, and data connections in the **Capability Center**.
2. Ask a question in **Research assistant**, or open **Stock research** and run the default plan. Default plans still require the relevant model, published strategy, and tools to be available.
3. Read the saved report. To compare perspectives, start an **Expert roundtable**, choose experts and a collaboration mode, and submit a topic.

The header includes a persistent Chinese/English language selector. The main workspaces, research configuration, default plans, and report controls follow this setting. Saved report prose, user-defined names, and source news retain their original language; switching the interface does not translate or rewrite research data.

For frontend development, run `npm run dev` under `apps/dsa-web` alongside the backend. Vite defaults to <http://127.0.0.1:5173> and proxies `/api` to port 8000; set `DSA_WEB_API_PROXY_TARGET` if the backend address differs.

## Development checks

```bash
./scripts/ci_gate.sh

cd apps/dsa-web
npm run lint
npm run build
```

## Documentation

- [Documentation index](docs/INDEX_EN.md)
- [Workspace interaction and layout](docs/workspace-ui.md) (Chinese)
- [Agent decision workspace](docs/web-decision-workspace.md)
- [Independent Agent engine integration](docs/agent-runtime-integration_EN.md)
- [Full configuration guide](docs/full-guide_EN.md)
- [Deployment guide](docs/DEPLOY_EN.md)
- [Testing guide](docs/testing.md)
- [Changelog](docs/CHANGELOG.md)

## License and disclaimer

This project is licensed under the [MIT License](LICENSE). It is intended for software engineering, investment research, and controlled historical or paper experiments. Research reports, screening results, proposals, and model outputs do not guarantee future performance. Users remain responsible for their own decisions and outcomes.
