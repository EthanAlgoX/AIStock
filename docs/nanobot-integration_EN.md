# Nanobot Agent Runtime Integration

LLM-TradeBot can delegate ask-stock execution to a separately running Nanobot. The website keeps the user-facing session, stock scope, and result presentation; Nanobot owns its ReAct model/tool loop, skills, built-in tools, MCP, session memory, safety limits, and recovery.

## Why a separate process

LLM-TradeBot and Nanobot currently require incompatible `tiktoken` ranges. The integration therefore does not copy Nanobot's Agent loop or install its Python SDK into the main process. It calls the official OpenAI-compatible API exposed by `nanobot serve`:

```text
Browser /overview
→ LLM-TradeBot Agent API
→ short-lived task capability grant
→ per-request restricted Tool / Skill view in nanobot serve
→ signed LLM-TradeBot finance MCP execution
```

This lets Nanobot upgrade, restart, and enforce tool permissions independently without handing its model, MCP, or provider credentials to LLM-TradeBot.

## Start Nanobot

Configure Nanobot in its own project or `nanobot-ai` environment:

```bash
python -m pip install nanobot-ai
nanobot plugins enable api
nanobot onboard --wizard
nanobot agent -m "Hello!"
nanobot serve --timeout 300
```

The website requires Nanobot `/health` to advertise `taskCapabilityIsolation: 1`. An older runtime is rejected even if it can answer chat requests, preventing silent capability-policy bypass. Nanobot must also mount the website finance MCP:

```json
{
  "tools": {
    "mcpServers": {
      "finance": {
        "type": "streamableHttp",
        "url": "http://127.0.0.1:8000/api/v1/mcp",
        "toolTimeout": 60,
        "enabledTools": ["*"]
      }
    },
    "ssrfWhitelist": ["127.0.0.1/32"]
  }
}
```

`finance` is the protocol-owned server name. The runtime may discover the full governed catalog at startup, but each turn exposes only the exact names authorized by the website.

The default API root is `http://127.0.0.1:8900`. When using a sibling source checkout, run equivalent commands in that project's own virtual environment; do not install its dependencies into the LLM-TradeBot environment.

## Configure the website

Save these values under **Settings → Agent**, or add them to `.env`:

```env
AGENT_MODE=true
AGENT_BACKEND=nanobot
AGENT_ARCH=single
NANOBOT_API_BASE=http://127.0.0.1:8900
NANOBOT_API_KEY=
AGENT_CAPABILITY_GRANT_SECRET=
```

`AGENT_CAPABILITY_GRANT_SECRET` may be empty for single-process development, which uses a process-random key. Multi-process, replicated, or rolling deployments must configure the same high-entropy value on every LLM-TradeBot instance.

After saving and restarting LLM-TradeBot, the status card under Agent settings checks `/health` and `/v1/models` without running an Agent turn. `/overview` always presents the unified “Main Agent” interface without exposing the underlying runtime name; the first submitted question is the first real Nanobot execution. The website consumes Nanobot's SSE response and shows the active stage, elapsed time, and a stop action. Stopping interrupts the underlying connection and terminates the original request as `cancelled`.

For public Nanobot API binds, configure `api.apiKey` in Nanobot and use the same Bearer token as `NANOBOT_API_KEY`. Production deployments should also use TLS, network access controls, and a reverse proxy. Treat this endpoint as Agent access with tool permissions, not as an ordinary stateless model endpoint.

## Ownership boundaries

| Capability | Owner | Current website behavior |
| --- | --- | --- |
| ReAct loop, sessions, and long-term memory | Nanobot | Configured and executed by Nanobot |
| Nanobot runtime Tools / Skills | Nanobot | Exact request-local view; unauthorized tools never enter model schemas and unauthorized skills never enter context or execute |
| Website stock-analysis skills | LLM-TradeBot | Handed off as investment methods and task constraints, never presented as Nanobot tools |
| Workspace Skills, Tools, MCP, data sources, and experts | LLM-TradeBot | Persisted and validated by the backend, then frozen into each Run |
| Website financial Tool Surface | LLM-TradeBot | Catalog published at `/api/v1/mcp`; execution also requires a valid signed task grant, exact Tool permission, stock scope, and data-source category |
| Stock scope, visible session, result display | LLM-TradeBot | Frozen and stored per turn |
| Trading, approval, and hard risk limits | LLM-TradeBot | Nanobot cannot bypass them; this integration only accepts analysis results |

The website maps each DSA session to a stable hashed Nanobot `session_id`, allowing Nanobot to continue its own memory without exposing the original ID. Deleting a website session does not delete the remote Nanobot session; clear it separately in Nanobot when full deletion is required.

## Strong-isolation sequence

1. The website validates task bindings and freezes the `capability_manifest`.
2. It signs a grant, valid for at most 15 minutes, covering this turn's Tools, Skills, data sources, and stock scope.
3. Nanobot constructs a request-local restricted ToolRegistry and filters skill summaries, always-on skills, and explicit `$skill` loading.
4. The `finance` MCP wrapper injects the opaque grant at execution time; the model cannot create or change it.
5. The website MCP gateway verifies the signature and rechecks exact Tool, stock scope, and required data-source category.
6. Unsupported protocol versions, missing or expired grants, and capability mismatches fail closed.

## Current limitations

- The OpenAI-compatible stream returns final-answer tokens, so the website does not receive Nanobot's complete Tool/MCP event trace or exact token usage from the streaming response.
- The website separates built-in Tools from MCP Servers. Healthy external HTTP MCP tools are proxied through the finance gateway under the same per-task authorization boundary; the website never executes stdio MCP commands.
- The website publishes only a governed finance Skill allowlist. General Nanobot skills for personal assistance, file organization, or social channels stay out of the default catalog, while session memory, the tool loop, recovery, and safety controls continue to come from the Nanobot runtime.
- Enabled financial READ / COMPUTE Tools are published at `/api/v1/mcp`, and `/api/v1/workspace/runtime-manifest` returns the isolation protocol, URL, and allowlist. Nanobot must still mount that HTTP MCP; the website does not start registered stdio commands.
- Data-source authorization currently enforces source IDs, data categories (market, news, fundamentals), and audit context. Existing provider fallback within one authorized category remains owned by the data service; providers are not automatically converted into separate Nanobot tools.
- Only `AGENT_ARCH=single` is supported. LLM-TradeBot Multi Agent and Deep Research are not routed through Nanobot.

## Rollback

Set `AGENT_BACKEND` back to `auto` or `litellm` and restart. Stopping the separate Nanobot process does not modify existing strategies, reports, data sources, or website session history.
