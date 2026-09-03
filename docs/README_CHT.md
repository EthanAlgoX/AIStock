<div align="center">

<img src="../apps/dsa-web/public/tradebot-mark.svg" alt="LLM TradeBot" width="76" height="76">

# LLM TradeBot

**以 Agent 為核心的股票研究、選股與受控交易實驗工作台**

主 Agent · 金融能力 · 結構化任務 · 可追溯運行

[English](../README.md) · [简体中文](README_ZH.md) · **繁體中文**

<br>

<img src="assets/readme/llm-tradebot-hero.jpg" alt="金融 Agent 編排經過治理的工具、資料與分析流程" width="100%">

</div>

> LLM TradeBot 面向 A 股、港股和美股，提供研究與模擬交易實驗能力。系統不會把模型輸出包裝成投資建議，也不允許 Agent 繞過確定性風控和執行邊界。

## 產品模型

主 Agent 是統一互動與任務編排層。使用者先在工作區配置通用金融能力，再為每個任務掛載允許使用的子集；系統最終保存正式成果，而不只保留聊天文字。

| 能力 | 負責內容 |
| --- | --- |
| **Skill** | 版本化的金融方法和任務指令 |
| **內建 Tool** | 具有輸入 Schema 的確定性查詢或計算 |
| **MCP** | 連接外部工具、資源和系統 |
| **資料來源** | 行情、基本面、新聞等事實輸入 |
| **專家 / 專家團** | 基於 Persona 的獨立評審和結構化討論 |

每次結構化執行都會把任務定義和能力選擇凍結到 `Run`，關聯相應的 `DataSnapshot`，並保存一個或多個有類型的 `Artifact` 成果。

## 主要工作台

| 頁面 | 路由 | 功能 |
| --- | --- | --- |
| 主 Agent | `/overview` | 通用對話、目標理解與能力編排 |
| 市場情報 | `/market-intelligence` | 使用已啟用資料來源生成可配置市場視圖 |
| 個股分析 | `/stock-research` | 選擇市場和股票、配置能力並生成研究報告 |
| 選股 | `/screening` | 定義選股目標並生成帶證據的候選清單 |
| 交易 | `/trading` | 配置模擬策略並生成受控交易提案 |

專家評審、排程任務、任務與運行記錄、模型用量和能力中心為上述工作台提供支援。舊上傳策略和策略實驗室不再屬於主產品鏈路。

## 安全與治理

- 工作區白名單和逐請求短時授權限制任務可用的 Skill、Tool、MCP、資料來源、專家和股票範圍。
- 內建 Tool 與 MCP 是兩種不同能力，分別配置、發現和授權。
- 網站負責任務、成果、審批、審計和交易邊界；Agent 可以分析和提出建議，但不能繞過風控或建立真實訂單。
- 金鑰只保存在環境變數或受保護設定中，不會出現在能力目錄和前端載荷裡。

## 快速開始

```bash
git clone https://github.com/EthanAlgoX/LLM-TradeBot.git
cd LLM-TradeBot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
cd apps/dsa-web && npm ci && npm run build && cd ../..
python main.py --serve-only --host 127.0.0.1 --port 8000
```

啟動後訪問 <http://127.0.0.1:8000>。更多資訊請參閱[文檔索引](INDEX.md)、[Agent 決策工作台](web-decision-workspace.md)與[完整配置指南](full-guide.md)。

## 授權與免責聲明

本專案採用 [MIT License](../LICENSE)，僅用於軟體工程、投資研究以及受控的歷史或模擬實驗。研究報告、選股結果、交易提案和模型輸出不保證未來表現，使用者應自行承擔投資決策與結果。
