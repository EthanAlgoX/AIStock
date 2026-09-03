<div align="center">

<img src="apps/dsa-web/public/tradebot-mark.svg" alt="LLM TradeBot" width="76" height="76">

# LLM TradeBot

**An Agent-first workspace for stock research, screening, and controlled trading experiments**

Main Agent · Financial capabilities · Structured tasks · Traceable runs

[![CI](https://github.com/EthanAlgoX/LLM-TradeBot/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanAlgoX/LLM-TradeBot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Agent_API-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

**English** · [简体中文](docs/README_ZH.md) · [繁體中文](docs/README_CHT.md)

<br>

<img src="docs/assets/readme/llm-tradebot-hero.jpg" alt="A financial Agent coordinating governed tools, data, and analysis workflows" width="100%">

</div>

> LLM TradeBot is a financial decision workspace for mainland China, Hong Kong, and US equities. It supports research and paper-trading experiments; it does not present model output as investment advice or bypass deterministic risk and execution controls.

## Product model

The Main Agent is the common interaction and orchestration layer. Users configure reusable financial capabilities at workspace level, attach an allowed subset to each task, and receive durable results rather than chat text alone.

| Capability | Responsibility |
| --- | --- |
| **Skill** | Versioned financial methods and task instructions |
| **Built-in Tool** | Schema-defined, deterministic read or compute operations |
| **MCP** | Connections to external tools, resources, and systems |
| **Data source** | Market, fundamental, news, and other factual inputs |
| **Expert / panel** | Persona-based independent reviews and structured deliberation |

Every structured execution freezes its task definition and capability selection into a `Run`, links the relevant `DataSnapshot`, and persists one or more typed `Artifact` results.

## Main workspaces

| Page | Route | Purpose |
| --- | --- | --- |
| Main Agent | `/overview` | General conversation, task interpretation, and capability orchestration |
| Market Intelligence | `/market-intelligence` | Configurable market views backed by enabled data sources |
| Stock Research | `/stock-research` | Select a market and stock, configure capabilities, and produce a report |
| Screening | `/screening` | Define a screening objective and produce an evidence-backed candidate list |
| Trading | `/trading` | Configure a paper strategy and produce controlled trade proposals |

Expert review, scheduled tasks, task/run history, model usage, and the Capability Center support these five decision workspaces. Legacy upload-strategy and strategy-laboratory routes are no longer part of the primary product flow.

## Safety and governance

- Workspace allowlists and request-local grants restrict which Skills, Tools, MCP servers, data sources, experts, and stocks a task can use.
- Built-in Tools and MCP servers are separate capability types with separate configuration pages and permissions.
- Independent Agent execution must advertise task-capability isolation; unsupported runtimes fail closed.
- The website owns tasks, artifacts, approvals, audit records, and trading boundaries. The Agent may analyze and propose, but it cannot bypass risk checks or create live orders.
- Secrets remain in environment or protected settings and are never returned in capability catalogs.

## Quick start

Requirements: Python 3.10+, Node.js 20.19+, and npm 10+.

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

Open the Web workspace at <http://127.0.0.1:8000> and API documentation at <http://127.0.0.1:8000/docs>.

For frontend development, run `npm run dev` under `apps/dsa-web`; Vite serves the app at <http://127.0.0.1:5173> and proxies `/api` to port 8000.

## Development checks

```bash
./scripts/ci_gate.sh

cd apps/dsa-web
npm run lint
npm run build
```

## Documentation

- [Documentation index](docs/INDEX_EN.md)
- [Agent decision workspace](docs/web-decision-workspace.md)
- [Independent Agent engine integration](docs/agent-runtime-integration_EN.md)
- [Full configuration guide](docs/full-guide_EN.md)
- [Deployment guide](docs/DEPLOY_EN.md)
- [Testing guide](docs/testing.md)

## License and disclaimer

This project is licensed under the [MIT License](LICENSE). It is intended for software engineering, investment research, and controlled historical or paper experiments. Research reports, screening results, proposals, and model outputs do not guarantee future performance. Users remain responsible for their own decisions and outcomes.
