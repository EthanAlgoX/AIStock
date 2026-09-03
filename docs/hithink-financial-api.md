# 同花顺 Financial API 数据源

项目已将 HiThink-Tech 的 Financial API 作为可选默认数据源接入现有数据源管理器。它与 MCP 保持独立：这里接入的是确定性 REST 数据源，不会注册为 Agent MCP 工具。

## 当前接入能力

- A 股最新行情快照；
- A 股前复权日 K；
- A 股代码与名称消歧；
- 上证指数、深证成指、创业板指、科创 50、上证 50、沪深 300 快照；
- 自动进入日 K、实时行情和市场指数的现有故障切换链；
- 可在策略数据源中显式选择 `kline:hithink_finance`。

该接口不承担港股、美股、新闻或宏观数据。未配置密钥、权限不足、网络失败或服务端异常时，自动模式会继续使用现有数据源；显式指定该连接时不会静默更换指定来源。

## 配置

在本地 `.env` 或 Web 的系统设置中配置：

```dotenv
HITHINK_FINANCE_API_KEY=your_api_key
HITHINK_FINANCE_BASE_URL=https://fuyao.aicubes.cn
HITHINK_FINANCE_TIMEOUT_SECONDS=15
HITHINK_FINANCE_PRIORITY=0
```

`HITHINK_FINANCE_API_KEY` 是敏感字段，不应写入代码、Prompt、日志或 Git。接口地址支持覆盖是为了可信的兼容网关；使用第三方地址意味着密钥和查询内容会经过该服务，请自行评估风险。

官方接口契约与可用范围以 [Financial API 仓库](https://github.com/HiThink-Tech/Financial-API) 为准。
