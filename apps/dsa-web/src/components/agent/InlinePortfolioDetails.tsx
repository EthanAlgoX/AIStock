import { useEffect, useState } from "react";
import { portfoliosApi, type Portfolio } from "../../api/portfolios";
import { toApiErrorMessage } from "../../api/error";
import { useUiLiteral } from "../../hooks/useUiLiteral";
import { PortfolioDetailWorkspace } from "./PortfolioDetailWorkspace";

/** Only the expanded account loads full records; collapse cancels its refresh. */
export function InlinePortfolioDetails({
  id,
  onManage,
  onResearch,
  onAdopt,
}: {
  id: number;
  onManage: (id: number) => void;
  onResearch: (id: number) => void;
  onAdopt: (id: number) => void;
}) {
  const t = useUiLiteral();
  const [selected, setSelected] = useState(id);
  const [panel, setPanel] = useState("executions");
  const [detail, setDetail] = useState<Portfolio | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await portfoliosApi.detail(selected);
        if (active) {
          setDetail(data);
          setError("");
        }
      } catch (e) {
        if (active) setError(toApiErrorMessage(e));
      } finally {
        if (active) timer = setTimeout(load, 30000);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selected, retry]);
  const current = detail?.id === selected ? detail : null;
  return (
    <div className="min-w-0 pb-6 pt-2">
      {error && (
        <div role="alert" className="mb-3 text-sm text-danger">
          {error}{" "}
          <button
            className="btn-secondary"
            onClick={() => setRetry((x) => x + 1)}
          >
            {t("重试")}
          </button>
        </div>
      )}
      {!current && !error && (
        <p role="status" className="py-8 text-secondary-text">
          {t("加载中…")}
        </p>
      )}
      {current && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-secondary-text">
              {t(current.mode === "paper" ? "实时模拟" : "历史回测")} · #
              {current.id} · {current.currency}
            </p>
            <div className="flex flex-wrap gap-2">
              {selected !== id && (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setSelected(id);
                    setPanel("executions");
                  }}
                >
                  {t("返回模拟账户")}
                </button>
              )}
              <button
                className="btn-secondary"
                onClick={() => onManage(selected)}
              >
                {t("策略设置与运行控制")}
              </button>
            </div>
          </div>
          {current.error && (
            <p role="alert" className="mb-3 text-danger">
              {current.error}
            </p>
          )}
          {current.mode === "backtest" && current.status !== "completed" && (
            <p className="mb-3 font-medium">
              {t("历史验证尚未完成，当前指标仅覆盖已记账日期。")}
            </p>
          )}
          <PortfolioDetailWorkspace
            compact
            key={selected}
            portfolio={current}
            panel={panel}
            onPanel={setPanel}
            onSelect={(next) => {
              setSelected(next);
              setPanel("performance");
            }}
            onAdopt={onAdopt}
            onBacktest={() => onResearch(selected)}
          />
        </>
      )}
    </div>
  );
}
