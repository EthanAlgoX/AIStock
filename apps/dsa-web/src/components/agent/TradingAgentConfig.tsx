import { useUiLiteral } from '../../hooks/useUiLiteral';
import { UiLiteral } from '../i18n/UiLiteral';
import { useEffect, useId, useRef, useState } from "react";
import {
  portfoliosApi,
  type AgentOptions,
  type RuleConfig,
  type UniversePreview,
  type UniverseScope,
} from "../../api/portfolios";
import { includesStockCode } from "../../utils/stockCode";
import { toApiErrorMessage } from "../../api/error";

const INDUSTRIES = [
  "金融", "医药生物", "信息技术", "半导体", "通信", "能源", "原材料",
  "工业制造", "可选消费", "必选消费", "公用事业", "房地产", "传媒教育",
];

export function TradingAgentConfig({
  config,
  inputText,
  codes,
  inferredMarket,
  onConfig,
  onPreview,
  initialQuery,
}: {
  initialQuery?: string;
  config: RuleConfig;
  inputText: string;
  codes: string[] | null;
  inferredMarket: RuleConfig["market"] | null;
  onConfig: (patch: Partial<RuleConfig>) => void;
  onPreview: (preview: UniversePreview | null) => void;
}) {
  const uiLiteral = useUiLiteral();
  const helpId = useId();
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [scope, setScope] = useState<UniverseScope>(
    config.universe?.scope || {
      mode: initialQuery ? "custom" : "fixed",
      symbols: [],
      query: initialQuery || "",
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
    return () => { generation.current++; };
  }, [scope, inputText, config.market, onPreview]);
  const input =
    "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  return (
    <div className="space-y-5 border-y border-border py-5">
      <fieldset disabled={busy} className="space-y-4">
        <legend className="mb-3 font-semibold"><UiLiteral text={"股票范围"} /></legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <UiLiteral text={"范围来源"} /><select
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
              <option value="fixed"><UiLiteral text={"指定股票"} /></option>
              <option value="holdings"><UiLiteral text={"我的持仓"} /></option>
              <option value="custom"><UiLiteral text={"按行业与条件筛选"} /></option>
            </select>
          </label>
          <label>
            <UiLiteral text={"市场"} /><select
              className={input}
              value={scope.mode === "fixed" ? inferredMarket || config.market : config.market}
              onChange={(e) =>
                onConfig({
                  market: e.target.value as RuleConfig["market"],
                  lotSize: e.target.value === "TW" ? 1000 : ["US", "KR"].includes(e.target.value) ? 1 : 100,
                })
              }
            >
              <option value="CN"><UiLiteral text={"A 股"} /></option>
              <option value="US"><UiLiteral text={"美股"} /></option>
              <option value="HK"><UiLiteral text={"港股"} /></option>
              <option value="TW"><UiLiteral text="台股" /></option>
              <option value="JP"><UiLiteral text="日股" /></option>
              <option value="KR"><UiLiteral text="韩股" /></option>
            </select>
          </label>
        </div>
        {scope.mode === "fixed" && (
          <p className="text-sm text-secondary-text">
            <UiLiteral text={"在上方股票输入框填写名称或代码，市场随代码识别。预览成功后，保存策略会固定这份股票名单。"} /></p>
        )}
        {scope.mode === "holdings" && (
          <>
            <label className="block">
              <UiLiteral text={"持仓账户"} /><select
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
                <option value=""><UiLiteral text={"请选择账户"} /></option>
                {options?.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.market}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-secondary-text">
              <UiLiteral text={"不勾选表示使用该账户全部同市场持仓；只引用股票范围，不导入持仓数量、成本和现金。"} /></p>
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
                  {h.symbol} · {h.quantity} <UiLiteral text={" 股"} /></label>
              ))}
            </div>
          </>
        )}
        {scope.mode === "custom" && (
          <>
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium"><UiLiteral text={"行业（可多选）"} /></span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setScope({
                      ...scope,
                      allIndustries: !scope.allIndustries,
                      industries: !scope.allIndustries ? [] : scope.industries,
                    })
                  }
                >
                  {scope.allIndustries ? uiLiteral("取消全选") : uiLiteral("全选")}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2" aria-label={uiLiteral("行业选择")}>
                {INDUSTRIES.map((industry) => (
                  <label key={uiLiteral(industry)} className="text-sm">
                    <input
                      type="checkbox"
                      checked={scope.allIndustries || (scope.industries || []).includes(industry)}
                      disabled={scope.allIndustries}
                      onChange={(e) =>
                        setScope({
                          ...scope,
                          industries: e.target.checked
                            ? [...(scope.industries || []), industry]
                            : (scope.industries || []).filter((item) => item !== industry),
                        })
                      }
                    />{" "}{uiLiteral(industry)}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-sm text-secondary-text">
                <UiLiteral text={"可选择一个或多个行业；全选表示不限行业。所选行业按并集筛选。"} /></p>
            </div>
            <label className="block">
              <UiLiteral text={"补充范围描述（可选）"} /><textarea
                className={input}
                maxLength={500}
                value={scope.query}
                onChange={(e) => setScope({ ...scope, query: e.target.value })}
                placeholder={uiLiteral("例如：中市值以上，成交活跃，近一个月价格波动较大")}
              />
            </label>
            <p className="text-sm text-secondary-text">
              <UiLiteral text={"先按市场和行业取得候选，再由模型判断你描述的市值、波动、流动性等条件。上方股票可不填；填写则只在这些股票中筛选。预览会显示数据覆盖范围；港股需先指定股票。"} /></p>
              <p className="text-xs text-muted-text"><UiLiteral text="港股、日股、韩股的条件筛选需要先指定股票。" /></p>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <UiLiteral text={"最多候选数"} /><input
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
            <UiLiteral text={"范围更新"} /><select
              className={input}
              value={config.scopeRefresh || "snapshot"}
              onChange={(e) =>
                onConfig({
                  scopeRefresh: e.target.value as RuleConfig["scopeRefresh"],
                })
              }
            >
              <option value="snapshot"><UiLiteral text={"固定本次确认名单"} /></option>
              <option value="daily"><UiLiteral text={"每天按相同条件更新"} /></option>
              <option value="weekly"><UiLiteral text={"每周按相同条件更新"} /></option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={async () => {
            setError("");
            setPreview(null);
            onPreview(null);
            if (inputText.trim() && !codes) {
              setError("请先确认上方股票识别结果。");
              return;
            }
            let selectedCodes = scope.mode === "holdings" ? scope.symbols : codes || [];
            if (scope.mode === "holdings" && codes?.length) {
              selectedCodes = scope.symbols.length ? scope.symbols.filter((s) => includesStockCode(codes, s)) : codes;
              if (!selectedCodes.length) {
                setError("填写的股票与所选持仓没有交集，请调整股票池或持仓范围。");
                return;
              }
            }
            const request = { ...scope, symbols: selectedCodes };
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
          {busy ? uiLiteral("正在获取候选并按条件筛选…") : uiLiteral("预览股票范围")}
        </button>
        <p className="text-xs text-secondary-text">
          <UiLiteral text={"修改市场、行业或条件后需重新预览。自定义范围会调用模型；核对下方名单后，保存策略即确认本次范围。"} /></p>
      </fieldset>
      {error && (
        <p role="alert" className="text-danger">
          {uiLiteral(error)}
        </p>
      )}
      {preview && (
        <div aria-label={uiLiteral("范围预览")} className="border-y border-border py-4">
          <p role="status" className="mb-2 text-sm font-medium"><UiLiteral text={"已预览 · "} />{preview.candidates.length} <UiLiteral text={" 只股票，保存策略后生效"} /></p>
          <p className="text-sm">
            {uiLiteral(preview.scope.rule?.description || "已找到符合范围的股票")}
          </p>
          <p className="mt-2 text-xs text-secondary-text">
            {uiLiteral(preview.coverage)} · {preview.source} · {preview.observedAt}
          </p>
          <ul className="mt-3 space-y-2">
            {preview.candidates.map((c) => (
              <li key={c.code} className="text-sm">
                {c.name || c.code} · {c.code}：{uiLiteral(c.reason)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <h3 className="pt-4 text-lg font-semibold"><UiLiteral text={"2. 策略配置"} /></h3>
      <label className="block">
        <UiLiteral text="交易决策模型" />
        <select className={input} value={config.decisionBackend || "llm"}
          onChange={(e) => onConfig({ decisionBackend: e.target.value as "llm" | "jev" })}>
          <option value="llm">{uiLiteral("LLM · 目标仓位与理由")}</option>
          <option value="jev">{uiLiteral("JEV · 仅决策结果")}</option>
        </select>
      </label>
      {config.decisionBackend === "jev" && (
        <div className="space-y-3">
          <p className="text-sm text-secondary-text"><UiLiteral text="JEV 根据 Skill、行情和模拟持仓判断买入、卖出或不动，返回概率，不生成报告。股票范围预览仍使用 LLM。" /></p>
          {options && !options.decisionModels?.find((m) => m.id === "jev")?.available && (
            <p role="status" className="text-sm"><UiLiteral text="请先在设置 → AI 模型中配置 JEV API Key。" /></p>
          )}
          <fieldset className="space-y-4">
            <legend className="font-medium"><UiLiteral text="JEV 判断任务与输入" /></legend>
            <p className="text-sm leading-6 text-secondary-text"><UiLiteral text="文字项均为选填，留空即可按默认规则运行；也可以只修改其中一项。" /></p>
            <button type="button" className="text-sm text-primary underline underline-offset-4"
              onClick={() => onConfig({ jevTask: {}, jevWeightStep: 0.05 })}>
              <UiLiteral text="恢复 JEV 默认设置" />
            </button>
            <label className="block text-sm"><UiLiteral text="判断问题" />
              <textarea className={input} rows={3} maxLength={4000} value={config.jevTask?.question || ""}
                aria-describedby={`${helpId}-question`}
                placeholder={uiLiteral("默认：根据当前 Skill、行情与模拟持仓，判断该股票应买入、卖出还是不动；证据不足时不动。")}
                onChange={(e) => onConfig({ jevTask: { ...config.jevTask, question: e.target.value } })} />
            </label>
            <p id={`${helpId}-question`} className="text-xs leading-6 text-secondary-text"><UiLiteral text="留空使用默认问题；填写后补充你的判断重点，不覆盖系统规则。" /></p>
            <p id={`${helpId}-criteria`} className="text-xs leading-6 text-secondary-text"><UiLiteral text="以下条件均可留空。默认按所选 Skill 判断方向，买卖各调整一档。" /></p>
            {([
              ['buy', '买入判定条件', '默认：策略支持增加该股票仓位时买入，每次增加一档。'],
              ['sell', '卖出判定条件', '默认：策略支持降低该股票仓位时卖出，每次减少一档。'],
              ['hold', '不动判定条件', '默认：保持当前持仓不变；未持有则继续空仓。'],
            ] as const).map(([key, label, hint]) => (
              <label key={key} className="block text-sm">{uiLiteral(label)}
                <textarea className={input} rows={2} maxLength={2000} value={config.jevTask?.criteria?.[key] || ""}
                  aria-describedby={`${helpId}-criteria`} placeholder={uiLiteral(hint)}
                  onChange={(e) => onConfig({ jevTask: { ...config.jevTask, criteria: { ...config.jevTask?.criteria, [key]: e.target.value } } })} />
              </label>
            ))}
            <label className="block text-sm"><UiLiteral text="行情观察天数" />
              <input className={input} type="number" min={3} max={21} step={1}
                value={config.jevTask?.lookbackDays ?? 21} aria-describedby={`${helpId}-lookback`}
                onChange={(e) => onConfig({ jevTask: { ...config.jevTask, lookbackDays: e.target.value === "" ? undefined : Number(e.target.value) } })} />
            </label>
            <p id={`${helpId}-lookback`} className="text-xs leading-6 text-secondary-text"><UiLiteral text="默认使用最近 21 个交易日，可调整为 3–21 天，且不能少于网格观察周期。行情、现金和持仓由系统提供。" /></p>
            <label className="block text-sm"><UiLiteral text="补充背景材料" />
              <textarea className={input} rows={3} maxLength={6000} value={config.jevTask?.background || ""}
                aria-describedby={`${helpId}-background`}
                placeholder={uiLiteral("例如：偏好低换手，优先控制仓位；已有持仓分批调整。没有补充要求可留空。")}
                onChange={(e) => onConfig({ jevTask: { ...config.jevTask, background: e.target.value } })} />
            </label>
            <p id={`${helpId}-background`} className="text-xs leading-6 text-secondary-text"><UiLiteral text="选填。留空不添加额外背景，仅使用 Skill 与系统数据。填写内容会固定保存，不会每日更新；历史回放请勿加入未来信息。" /></p>
          </fieldset>
          <label className="block text-sm">
            <UiLiteral text="每次调仓比例（账户权益 %）" />
            <input className={input} type="number" min={0.1} max={100} step={0.1}
              value={Number(((config.jevWeightStep ?? 0.05) * 100).toFixed(4))} aria-describedby={`${helpId}-step`}
              onChange={(e) => onConfig({ jevWeightStep: e.target.value === "" ? undefined : Number(e.target.value) / 100 })} />
          </label>
          <p id={`${helpId}-step`} className="text-xs leading-6 text-secondary-text"><UiLiteral text="默认每档为账户权益的 5%，买入增加一档，卖出减少一档；实际调仓仍受可用资金和持仓上限约束。" /></p>
        </div>
      )}
      <label className="block">
        <UiLiteral text={"策略 Skill"} /><select
          required
          className={input}
          value={config.skillId || ""}
          onChange={(e) => onConfig({ skillId: e.target.value })}
        >
          <option value=""><UiLiteral text={"选择策略方法"} /></option>
          {options?.skills.map((s) => (
            <option key={s.id} value={s.id}>
              {uiLiteral(s.name)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-secondary-text">
        {uiLiteral(options?.skills.find((s) => s.id === config.skillId)?.description ||
          "Skill 决定分析方法；交易输出规范和程序风控共同约束买卖计划。保存后固定 Skill 内容。")}
      </p>
      {config.skillId === "high_volume_volatility_grid" && (
        <div className="rounded-lg border border-border p-4">
          <h4 className="font-medium"><UiLiteral text={"高量高波动网格参数"} /></h4>
          <p className="mt-1 text-sm leading-6 text-secondary-text">
            <UiLiteral text={"Agent 只使用冻结日线和这些参数形成目标仓位；成交仍在下一交易日开盘由模拟账本执行。"} /></p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {([
              ["gridLookbackDays", "观察周期（交易日）", 3, 20, 1],
              ["gridMinVolumeRatio", "最低成交量倍数", 1, 10, 0.1],
              ["gridMinRange", "最低区间波动率", 0.005, 0.5, 0.005],
              ["gridLevels", "网格档数", 2, 10, 1],
            ] as const).map(([key, label, min, max, step]) => (
              <label key={key} className="text-sm">
                {uiLiteral(label)}
                <input
                  className={input}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={config[key] ?? (key === "gridLookbackDays" ? 5 : key === "gridMinVolumeRatio" ? 1.3 : key === "gridMinRange" ? 0.05 : 5)}
                  onChange={(e) => onConfig({ [key]: Number(e.target.value) })}
                />
                {key === "gridMinRange" && <span className="mt-1 block text-xs text-secondary-text"><UiLiteral text={"0.05 表示 5%"} /></span>}
              </label>
            ))}
          </div>
        </div>
      )}
      <details>
        <summary className="cursor-pointer font-medium">
          <UiLiteral text={config.decisionBackend === "jev" ? "补充策略指令" : "交易 System Prompt"} /></summary>
        <label className="mt-3 block">
          <UiLiteral text={"自定义交易指令"} /><textarea
            className={input}
            rows={5}
            maxLength={6000}
            value={config.systemPrompt || ""}
            aria-describedby={`${helpId}-instructions`}
            onChange={(e) => onConfig({ systemPrompt: e.target.value })}
            placeholder={uiLiteral("例如优先控制换手；证据不足时维持现有仓位")}
          />
        </label>
        <p id={`${helpId}-instructions`} className="mt-2 text-xs text-secondary-text">
          {config.decisionBackend === "jev"
            ? uiLiteral("选填。留空使用所选 Skill 和系统交易规则，无需自行编写提示词。")
            : options?.defaultPrompt}
        </p>
      </details>
    </div>
  );
}
