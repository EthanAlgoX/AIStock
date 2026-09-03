# Independent Main Agent Engine

LLM-TradeBot can delegate the Main Agent model-tool loop to a separate process. The website owns sessions, stock scope, financial capability governance, visible history, and results; the engine owns ReAct, Skills, Tools, MCP, memory, safety limits, and recovery.

## Why a separate process

A separate process isolates Agent dependencies, model credentials, and runtime state from the analysis and reporting stack. The website submits tasks through a controlled OpenAI-compatible API:

```text
Browser /overview
→ LLM-TradeBot Agent API
→ short-lived task capability grant
→ per-request restricted Tool / Skill view in the independent Agent service
→ signed LLM-TradeBot finance MCP execution
```

The engine can upgrade, restart, and enforce permissions independently without handing model, MCP, or provider credentials to the website.

## Engine protocol

The engine must provide `/health`, `/v1/models`, and `/v1/chat/completions`. Its health response must advertise `taskCapabilityIsolation: 1`; otherwise the website rejects it even if it can answer chat requests. The engine must also mount the website finance MCP:

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

The default API root is `http://127.0.0.1:8900`. Run the engine in a separate virtual environment or container instead of installing its dependencies into the LLM-TradeBot process environment.

## Configure the website

Save these values under **Settings → Agent**, or add them to `.env`:

```env
AGENT_MODE=true
AGENT_BACKEND=external_runtime
AGENT_ARCH=single
AGENT_RUNTIME_API_BASE=http://127.0.0.1:8900
AGENT_RUNTIME_API_KEY=
AGENT_CAPABILITY_GRANT_SECRET=
```

`AGENT_CAPABILITY_GRANT_SECRET` may be empty for single-process development, which uses a process-random key. Multi-process, replicated, or rolling deployments must configure the same high-entropy value on every LLM-TradeBot instance.

After saving and restarting LLM-TradeBot, the status card under Agent settings checks `/health` and `/v1/models` without running an Agent turn. `/overview` always presents the unified “Main Agent” interface without exposing the underlying runtime name; the first submitted question is the first real Independent Agent Engine execution. The website consumes Independent Agent Engine's SSE response and shows the active stage, elapsed time, and a stop action. Stopping interrupts the underlying connection and terminates the original request as `cancelled`.

For public Independent Agent Engine API binds, configure `api.apiKey` in Independent Agent Engine and use the same Bearer token as `AGENT_RUNTIME_API_KEY`. Production deployments should also use TLS, network access controls, and a reverse proxy. Treat this endpoint as Agent access with tool permissions, not as an ordinary stateless model endpoint.

## Ownership boundaries

| Capability | Owner | Current website behavior |
| --- | --- | --- |
| ReAct loop, sessions, and long-term memory | Independent Agent Engine | Configured and executed by Independent Agent Engine |
| Independent Agent Engine runtime Tools / Skills | Independent Agent Engine | Exact request-local view; unauthorized tools never enter model schemas and unauthorized skills never enter context or execute |
| Website stock-analysis skills | LLM-TradeBot | Handed off as investment methods and task constraints, never presented as Independent Agent Engine tools |
| Workspace Skills, Tools, MCP, data sources, and experts | LLM-TradeBot | Persisted and validated by the backend, then frozen into each Run |
| Website financial Tool Surface | LLM-TradeBot | Catalog published at `/api/v1/mcp`; execution also requires a valid signed task grant, exact Tool permission, stock scope, and data-source category |
| Stock scope, visible session, result display | LLM-TradeBot | Frozen and stored per turn |
| Trading, approval, and hard risk limits | LLM-TradeBot | Independent Agent Engine cannot bypass them; this integration only accepts analysis results |

The website maps each DSA session to a stable hashed Independent Agent Engine `session_id`, allowing Independent Agent Engine to continue its own memory without exposing the original ID. Deleting a website session does not delete the remote Independent Agent Engine session; clear it separately in Independent Agent Engine when full deletion is required.

## Strong-isolation sequence

1. The website validates task bindings and freezes the `capability_manifest`.
2. It signs a grant, valid for at most 15 minutes, covering this turn's Tools, Skills, data sources, and stock scope.
3. Independent Agent Engine constructs a request-local restricted ToolRegistry and filters skill summaries, always-on skills, and explicit `$skill` loading.
4. The `finance` MCP wrapper injects the opaque grant at execution time; the model cannot create or change it.
5. The website MCP gateway verifies the signature and rechecks exact Tool, stock scope, and required data-source category.
6. Unsupported protocol versions, missing or expired grants, and capability mismatches fail closed.

## Current limitations

- The OpenAI-compatible stream returns final-answer tokens, so the website does not receive Independent Agent Engine's complete Tool/MCP event trace or exact token usage from the streaming response.
- The website separates built-in Tools from MCP Servers. Healthy external HTTP MCP tools are proxied through the finance gateway under the same per-task authorization boundary; the website never executes stdio MCP commands.
- The website publishes only a governed finance Skill allowlist. General Independent Agent Engine skills for personal assistance, file organization, or social channels stay out of the default catalog, while session memory, the tool loop, recovery, and safety controls continue to come from the Independent Agent Engine runtime.
- Enabled financial READ / COMPUTE Tools are published at `/api/v1/mcp`, and `/api/v1/workspace/runtime-manifest` returns the isolation protocol, URL, and allowlist. Independent Agent Engine must still mount that HTTP MCP; the website does not start registered stdio commands.
- Data-source authorization currently enforces source IDs, data categories (market, news, fundamentals), and audit context. Existing provider fallback within one authorized category remains owned by the data service; providers are not automatically converted into separate Independent Agent Engine tools.
- Only `AGENT_ARCH=single` is supported. LLM-TradeBot Multi Agent and Deep Research are not routed through Independent Agent Engine.

## Rollback

Set `AGENT_BACKEND` back to `auto` or `litellm` and restart. Stopping the separate Independent Agent Engine process does not modify existing strategies, reports, data sources, or website session history.
