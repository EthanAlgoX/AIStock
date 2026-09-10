import { useEffect, useRef, useState } from "react";
import {
  portfoliosApi,
  type AgentOptions,
  type RuleConfig,
  type UniversePreview,
  type UniverseScope,
} from "../../api/portfolios";
import { toApiErrorMessage } from "../../api/error";

export function TradingAgentConfig({
  config,
  inputText,
  codes,
  inferredMarket,
  onConfig,
  onPreview,
}: {
  config: RuleConfig;
  inputText: string;
  codes: string[] | null;
  inferredMarket: RuleConfig["market"] | null;
  onConfig: (patch: Partial<RuleConfig>) => void;
  onPreview: (preview: UniversePreview | null) => void;
}) {
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [scope, setScope] = useState<UniverseScope>(
    config.universe?.scope || {
      mode: "fixed",
      symbols: [],
      query: "",
      maxCandidates: 12,
    },
  );
  const [holdings, setHoldings] = useState<
    { symbol: string; quantity: number }[]
  >([]);
  const [preview, setPreview] = useState<UniversePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    portfoliosApi
      .agentOptions()
      .then((o) => {
        if (alive) setOptions(o);
      })
      .catch((e) => {
        if (alive) setError(toApiErrorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setPreview(null);
    onPreview(null);
  }, [scope, inputText, config.market, onPreview]);
  const input =
    "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  return (
    <div className="space-y-5 border-y border-border py-5">
      <label className="block">
        策略 Skill
        <select
          required
          className={input}
          value={config.skillId || ""}
          onChange={(e) => onConfig({ skillId: e.target.value })}
        >
          <option value="">选择策略方法</option>
          {options?.skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-secondary-text">
        {options?.skills.find((s) => s.id === config.skillId)?.description ||
          "Skill 决定分析方法；交易输出规范和程序风控共同约束买卖计划。保存后固定 Skill 内容。"}
      </p>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="mb-3 font-semibold">股票范围</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            范围来源
            <select
              className={input}
              value={scope.mode}
              onChange={(e) =>
                setScope({
                  ...scope,
                  mode: e.target.value as UniverseScope["mode"],
                  symbols: [],
                })
              }
            >
              <option value="fixed">指定股票</option>
              <option value="holdings">我的持仓</option>
              <option value="custom">自定义行业或弹性条件</option>
            </select>
          </label>
          <label>
            市场
            <select
              className={input}
              value={scope.mode === "fixed" ? inferredMarket || config.market : config.market}
              onChange={(e) =>
                onConfig({
                  market: e.target.value as RuleConfig["market"],
                  lotSize: e.target.value === "US" ? 1 : 100,
                })
              }
            >
              <option value="CN">A 股</option>
              <option value="US">美股</option>
              <option value="HK">港股</option>
            </select>
          </label>
        </div>
        {scope.mode === "fixed" && (
          <p className="text-sm text-secondary-text">
            在上方股票输入框填写名称或代码，市场随代码识别。
          </p>
        )}
        {scope.mode === "holdings" && (
          <>
            <label className="block">
              持仓账户
              <select
                className={input}
                value={scope.accountId || ""}
                onChange={async (e) => {
                  const accountId = Number(e.target.value);
                  setScope({ ...scope, accountId, symbols: [] });
                  setHoldings([]);
                  if (!accountId) return;
                  setBusy(true);
                  try {
                    setHoldings(await portfoliosApi.holdings(accountId));
                  } catch (e) {
                    setError(toApiErrorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <option value="">请选择账户</option>
                {options?.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.market}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-secondary-text">
              不勾选表示使用该账户全部同市场持仓；只引用股票范围，不导入持仓数量、成本和现金。
            </p>
            <div className="flex flex-wrap gap-3">
              {holdings.map((h) => (
                <label key={h.symbol}>
                  <input
                    type="checkbox"
                    checked={scope.symbols.includes(h.symbol)}
                    onChange={(e) =>
                      setScope({
                        ...scope,
                        symbols: e.target.checked
                          ? [...scope.symbols, h.symbol]
                          : scope.symbols.filter((s) => s !== h.symbol),
                      })
                    }
                  />{" "}
                  {h.symbol} · {h.quantity} 股
                </label>
              ))}
            </div>
          </>
        )}
        {scope.mode === "custom" && (
          <>
            <label className="block">
              范围描述
              <textarea
                className={input}
                maxLength={500}
                value={scope.query}
                onChange={(e) => setScope({ ...scope, query: e.target.value })}
                placeholder="例如 科技行业，或20日波动较大的股票"
              />
            </label>
            <p className="text-sm text-secondary-text">
              AI
              将描述转成行业关键词或20日波动率条件。下方股票可不填；填写则进一步限制在这些股票中。候选来自现有选股源，不保证覆盖全市场。
            </p>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            最多候选数
            <input
              className={input}
              type="number"
              min={1}
              max={12}
              value={scope.maxCandidates}
              onChange={(e) =>
                setScope({ ...scope, maxCandidates: Number(e.target.value) })
              }
            />
          </label>
          <label>
            范围更新
            <select
              className={input}
              value={config.scopeRefresh || "snapshot"}
              onChange={(e) =>
                onConfig({
                  scopeRefresh: e.target.value as RuleConfig["scopeRefresh"],
                })
              }
            >
              <option value="snapshot">固定本次确认名单</option>
              <option value="daily">每天按相同条件更新</option>
              <option value="weekly">每周按相同条件更新</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={async () => {
            setError("");
            if (scope.mode !== "holdings" && !codes) {
              setError("请先确认上方股票识别结果。");
              return;
            }
            const request = {
              ...scope,
              symbols: scope.mode === "holdings" ? scope.symbols : codes || [],
            };
            const market =
              scope.mode === "fixed"
                ? inferredMarket || config.market
                : config.market;
            setBusy(true);
            const attempt = generation.current;
            try {
              const result = await portfoliosApi.previewUniverse(
                market,
                request,
              );
              if (generation.current === attempt) {
                setPreview(result);
                onPreview(result);
              }
            } catch (e) {
              setError(toApiErrorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "正在解析并查找候选…" : "预览范围与筛选依据"}
        </button>
        <p className="text-xs text-secondary-text">
          自定义范围解析会调用模型并记录 Token
          消耗。保存策略即确认这套筛选条件。
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {preview && (
        <div aria-label="范围预览" className="border-y border-border py-4">
          <p className="text-sm">
            {preview.scope.rule?.description || "已找到符合范围的股票"}
          </p>
          <p className="mt-2 text-xs text-secondary-text">
            {preview.coverage} · {preview.source} · {preview.observedAt}
          </p>
          <ul className="mt-3 space-y-2">
            {preview.candidates.map((c) => (
              <li key={c.code} className="text-sm">
                {c.name || c.code} · {c.code}：{c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details>
        <summary className="cursor-pointer font-medium">
          交易 System Prompt 与运行预算
        </summary>
        <label className="mt-3 block">
          自定义交易指令
          <textarea
            className={input}
            rows={5}
            maxLength={6000}
            value={config.systemPrompt || ""}
            onChange={(e) => onConfig({ systemPrompt: e.target.value })}
            placeholder="例如优先控制换手；证据不足时维持现有仓位"
          />
        </label>
        <p className="mt-2 text-xs text-secondary-text">
          {options?.defaultPrompt}
        </p>
        <label className="mt-3 block">
          每次运行 Token 预算
          <input
            className={input}
            type="number"
            min={10000}
            max={500000}
            step={10000}
            value={config.runTokenBudget || 100000}
            onChange={(e) =>
              onConfig({ runTokenBudget: Number(e.target.value) })
            }
          />
        </label>
      </details>
    </div>
  );
}
