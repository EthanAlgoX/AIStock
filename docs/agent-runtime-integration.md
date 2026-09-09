# 主 Agent 独立运行引擎接入

AI Stock 可以把主 Agent 的模型—工具循环交给独立进程。网站负责会话入口、股票范围、金融能力治理、用户可见历史和结果展示；独立引擎负责 ReAct、Skill、Tool、MCP、会话记忆、安全限制和恢复机制。

## 为什么使用独立进程

独立进程可以隔离 Agent 引擎依赖、模型凭据和运行时状态，避免破坏现有分析、报告和策略链路。网站通过受控的 OpenAI-compatible API 提交任务：

```text
浏览器 /overview
→ AI Stock Agent API
→ 短时任务能力授权
→ 独立 Agent 引擎的逐任务 Tool / Skill 受限视图
→ 带签名授权的 AI Stock 金融 MCP
```

引擎可以独立升级、重启和收紧权限，不需要把模型、MCP 或 provider 密钥交给网站。

## 引擎协议要求

引擎必须提供 `/health`、`/v1/models` 和 `/v1/chat/completions`，并在 `/health` 明确声明 `taskCapabilityIsolation: 1`。不支持隔离协议的引擎即使能够聊天也会被网站拒绝。引擎还需挂载网站的金融 MCP：

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

`finance` 是协议固定名称。Runtime 可以在启动时发现工作区内全部可发布金融工具，但每一轮只会向模型暴露网站授权的精确名称。

默认 API 根地址为 `http://127.0.0.1:8900`。引擎应使用独立虚拟环境或容器运行，不要把其依赖安装进 AI Stock 主进程环境。

## 配置网站

可以在「设置 → Agent 设置」中保存，也可以写入 `.env`：

```env
AGENT_MODE=true
AGENT_BACKEND=external_runtime
AGENT_ARCH=single
AGENT_RUNTIME_API_BASE=http://127.0.0.1:8900
AGENT_RUNTIME_API_KEY=
AGENT_CAPABILITY_GRANT_SECRET=
```

单进程开发环境可不设置 `AGENT_CAPABILITY_GRANT_SECRET`，此时使用进程级随机密钥。多进程、多副本或滚动部署必须给所有 AI Stock 实例配置同一个高强度随机值，否则授权可能被另一个实例判为无效。

保存并重启 AI Stock 后，Agent 设置页的状态卡会调用独立 Agent 引擎的 `/health` 与 `/v1/models` 做轻量检查，不会执行模型任务。`/overview` 始终只展示统一的“主 Agent”界面，不暴露底层 Runtime 名称；第一次提问才会真正进入独立 Agent 引擎。网站通过独立 Agent 引擎的 SSE 响应接收最终内容，并在运行中展示阶段、耗时和停止入口；用户停止后会中断底层连接，使原请求以 `cancelled` 终止。

公开绑定独立 Agent 引擎 API 时，必须在引擎侧配置 `api.apiKey`，并把相同 Bearer Token 填入 `AGENT_RUNTIME_API_KEY`。生产环境还应使用 TLS、网络访问控制和反向代理；该端点拥有 Agent 工具权限，不能按普通无状态模型接口暴露。

## 能力与状态归属

| 能力 | 归属 | 当前网站行为 |
| --- | --- | --- |
| ReAct 循环、会话与长期记忆 | 独立 Agent 引擎 | 由独立 Agent 引擎配置和执行 |
| 引擎 Tool / Skill | 独立 Agent 引擎 | 每轮构造精确受限视图；未获授权的能力不进入模型 Schema 或 Skill 上下文，也无法被执行 |
| 网站内置股票分析 Skill | AI Stock | 选中后作为投资分析方法与任务约束交给独立 Agent 引擎，不冒充引擎工具 |
| 工作区 Skill、Tool、MCP、数据源和专家目录 | AI Stock | 后端持久化、校验绑定并冻结到每次 Run |
| 站内金融 Tool Surface | AI Stock | 通过 `/api/v1/mcp` 发布目录；执行时必须同时通过工作区白名单、短时签名授权、股票范围和数据源类型校验 |
| 股票范围、可见会话、结果展示 | AI Stock | 每轮冻结并保存 |
| 交易、审批和硬风控 | AI Stock | 不允许独立 Agent 引擎绕过；当前接入只允许其提出分析结果 |

网站会把同一个 DSA 会话映射为稳定、不可反推出原始 ID 的引擎 `session_id`，因此独立 Agent 引擎可以延续自己的会话记忆。删除网站会话不会远程删除引擎的持久会话；需要彻底删除时，还应在引擎侧执行相应会话清理。

## 强隔离执行顺序

1. 网站校验任务绑定并冻结 `capability_manifest`；
2. 网站根据本轮 Tool、Skill、数据源和股票范围签发最长 15 分钟的 HMAC 授权；
3. 独立 Agent 引擎为本轮构造新的 ToolRegistry 受限视图，并过滤 Skill 摘要、always Skill 和显式 `$skill` 加载；
4. `finance` MCP Wrapper 在真正调用时注入授权，模型无法自行生成或修改；
5. 网站 MCP 网关重新验签，并再次检查精确 Tool、股票范围与所需数据源类型；
6. 任一层不支持协议、缺少授权、授权过期或能力不匹配时均 fail closed。

## 当前限制

- 独立 Agent 引擎的 OpenAI-compatible 流当前只把最终回复 token 返回给网站；网站无法展示引擎内部每一次 Tool/MCP 调用的完整事件链，也不会从流式响应取得精确 token usage。
- 网站已将内置 Tool 与 MCP Server 拆分为独立配置页。健康的外部 HTTP MCP 会通过站内金融网关代理，并使用同一逐任务授权边界；stdio MCP 不由网站执行。
- 网站只展示经过治理的金融 Skill 白名单。独立 Agent 引擎的非金融个人助理、文件整理、社交渠道等通用 Skill 不进入默认目录；会话、记忆、工具循环、任务恢复和安全限制仍继续复用独立 Agent 引擎。
- 网站在 `/api/v1/mcp` 发布启用的金融 READ / COMPUTE Tool，并在 `/api/v1/workspace/runtime-manifest` 返回隔离协议、连接地址与白名单。独立 Agent 引擎仍需在自身配置中挂载该 HTTP MCP；网站不会启动用户登记的 stdio 命令。
- 数据源授权当前落实到数据类别（行情、新闻、基本面）与具体来源 ID 的审计上下文；底层同类别 provider fallback 仍由现有数据服务管理，不会把每个供应商自动变为独立 Agent Tool。
- 当前仅支持 `AGENT_ARCH=single`，不接入 AI Stock 原有 Multi Agent 或 Deep Research。

这些边界会在主 Agent 能力面板和配置页持续显示，避免把“已登记”误写成“已可调用”。

## 回滚

将 `AGENT_BACKEND` 改回 `auto` 或 `litellm` 并重启即可恢复原有问股 Agent。独立 Agent 引擎是独立进程，停用它不会修改已有策略、报告、数据源或历史会话。
