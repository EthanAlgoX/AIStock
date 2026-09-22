# International equity markets

[简体中文](international-markets.md)

Research and screening accept the markets below. Use the explicit exchange suffix; a bare numeric code does not identify an overseas market. Interface language and investment market are independent.

| Market | Example symbols | Daily data | Paper simulation |
| --- | --- | --- | --- |
| Taiwan listed / OTC | `2330.TW` / `6488.TWO` | TWSE / TPEx official monthly bars, then YFinance | TWD |
| Japan | `7203.T` | J-Quants V2 when configured, then YFinance | JPY |
| Korea | `005930.KS` / `035720.KQ` | KRX when configured, then YFinance | KRW |
| United Kingdom | `HSBA.L` | YFinance | Not enabled |
| Canada | `RY.TO` / `.V` | YFinance | Not enabled |
| Australia | `BHP.AX` | YFinance | Not enabled |
| India | `RELIANCE.NS` / `500325.BO` | YFinance | Not enabled |
| Germany | `SAP.DE` / `.F` | YFinance | Not enabled |
| France | `AIR.PA` | YFinance | Not enabled |

Examples illustrate syntax, not recommendations. Existing China, Hong Kong and US support remains available.

## Getting started

1. Open Stock research, choose the market and enter a qualified symbol. A symbol absent from the directory can be selected directly; the provider verifies whether observations exist.
2. Select a research strategy for that market. New reports use the task's interface language: English, Simplified Chinese, Traditional Chinese, Japanese or Korean.
3. In screening, choose International price and volume for the market. This compares a **bounded candidate sample**, not the entire exchange. Taiwan uses the first 50 official directory entries; Japan and Korea can use the first 50 matching local directory entries. Configure symbols for other markets.
4. Taiwan, Japan and Korea also support paper simulation. Enter same-market symbols, preview, save and start. Japanese and Korean natural-language screening requires explicit symbols. Default lot sizes are 1,000, 100 and 1 shares respectively; adjust for the security and your whole/odd-lot assumptions. Fees are user-defined simulation parameters, not a current exchange fee schedule.

Set a reproducible universe of up to 50 symbols per market and restart:

```dotenv
SCREENING_INTERNATIONAL_TICKERS={"TW":["2330.TW","6488.TWO"],"JP":["7203.T"],"KR":["005930.KS"],"GB":["HSBA.L"],"CA":["RY.TO"],"AU":["BHP.AX"],"IN":["RELIANCE.NS"],"DE":["SAP.DE"],"FR":["AIR.PA"]}
```

US screening retains its existing universe and `SCREENING_US_TICKERS` configuration.

## Credentials and limitations

Configure optional keys in platform settings or the environment:

```dotenv
JQUANTS_API_KEY=your_key
KRX_API_KEY=your_key
```

- Taiwan requires no key. Monthly responses and company directories are cached in-process with hourly refresh. TPEx lots and thousands of currency units are multiplied by 1,000; ROC dates become Gregorian dates.
- J-Quants uses V2 `x-api-key`. **Free data is delayed by 12 weeks**, unsuitable for current paper trading. The simulation engine requires the latest closed session and refuses to advance on stale prices.
- KRX requires approval for the relevant stock and ETF endpoints. Initial history uses per-session requests with time and two-year limits; failures use the existing fallback chain. Cache contents are process-local.
- UK snapshot quotes in GBp / GBX are normalized to GBP. Snapshot traded value is an estimate of closing price times volume, not exchange-reported turnover. Missing fundamentals remain missing; complete local filings and corporate actions are not provided.
- Local news coverage is incomplete. Formal presets disable news connections that do not declare support for the market. India uses the BSE research calendar, which does not describe NSE special sessions; secondary markets have no simulation entry point.
- Static interface text follows language changes. New tasks and model explanations use the selected task language. User input, identifiers, saved reports and historical audit records retain their original content.

Open-source adapters do not grant redistribution rights. Review [TWSE](https://openapi.twse.com.tw/), [TPEx](https://www.tpex.org.tw/openapi/), [J-Quants](https://jpx-jquants.com/en), [KRX terms](https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO005.jsp) and [Yahoo's data-use notice](https://help.yahoo.com/kb/SLN2310.html) before public deployment. Possessing a key does not automatically authorize commercial use or public display.

## Verification and rollback

Offline tests cover routing, market isolation, official schemas, date/unit conversion, pagination and simulation configuration. TWSE and TPEx monthly bars were checked online during development. Japanese/Korean authenticated endpoints require real credentials for live acceptance; mocked tests are not live verification.

Before reverting, stop automatic tasks for newly supported markets and back up the database. Do not run those configurations on an older version that lacks their market support. Preserve historical reports and ledgers.

## Market radar

Radar shares the same 12 market choices as stock research. Switching markets updates index snapshots, news filters and saved dashboards; overseas markets never fall back to A-share indices. UK, Canadian, Australian, Indian, German and French indices use the existing Yahoo Finance provider, with symbols checked against its [world index directory](https://finance.yahoo.com/markets/world-indices/). Missing data remains unavailable rather than being replaced with sample quotes.

All 12 markets support one-click reviews with their own indices, news queries and analysis frameworks. Missing breadth, capital flows and sector data are never substituted from another market. New reviews, analysis subscriptions and data-only reports when AI is unavailable follow the selected language. Historical news and reports retain their original language.

`MARKET_REVIEW_REGION` accepts one market or comma-separated subsets such as `tw,jp,kr` and `gb,de,fr`. To preserve the scope and cost of existing schedules, `both` still means `cn,hk,us,jp,kr`. Explicitly select `cn,hk,us,jp,kr,tw,gb,ca,au,in,de,fr` for all markets. No database migration is needed; when rolling back code, also restore region settings to values supported by the older version.

Dedicated macro monitoring panels currently cover CN, HK and US; other markets display global observations and an availability note. Their review reports use the appropriate market framework and available evidence. News depends on configured sources, not built-in coverage for every market.
