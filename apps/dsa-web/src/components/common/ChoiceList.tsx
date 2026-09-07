import { useCallback, useId, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "../../utils/cn";
import { Tooltip } from "./Tooltip";
import { useUiLanguage } from "../../contexts/UiLanguageContext";

export type ChoiceItem = { id: string; name: string; description?: string | null; badge?: string; disabled?: boolean };

/** Compact disclosure with native radio/checkbox semantics and a bounded, searchable list. */
export default function ChoiceList({ label, items, selectedIds, onSelect, multiple = false, limit, loading = false, error, emptyText = "暂无可选项", placeholder = "请选择", disabled = false, placement = "inline" }: {
  label: string;
  items: ChoiceItem[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  multiple?: boolean;
  limit?: number;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  placeholder?: string;
  disabled?: boolean;
  placement?: "inline" | "above";
}) {
  const { localize, translate: tx } = useUiLanguage();
  label = tx(label);
  placeholder = tx(placeholder);
  emptyText = tx(emptyText);
  items = items.map((item) => ({ ...item, name: tx(item.name), description: item.description ? tx(item.description) : undefined, badge: item.badge ? tx(item.badge) : undefined }));
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const focusSearch = useCallback((node: HTMLInputElement | null) => { node?.focus(); }, []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedNames = selectedIds.map((key) => items.find((item) => item.id === key)?.name || `${key}${localize('（目录未列出）', ' (not listed)')}`);
  const missing = selectedIds.filter((key) => !items.some((item) => item.id === key));
  const available: ChoiceItem[] = multiple ? [...items, ...missing.map((key) => ({ id: key, name: `${key}${localize('（目录未列出）', ' (not listed)')}`, description: localize('可以取消这项已有选择。', 'You can remove this existing selection.') }))] : items;
  const keyword = query.trim().toLocaleLowerCase();
  const filtered = available.filter((item) => `${item.name} ${item.description || ""}`.toLocaleLowerCase().includes(keyword));
  const close = () => { setOpen(false); setQuery(""); };

  return <div className="relative min-w-0" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); }
  }}>
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span id={`${id}-label`} className="text-sm font-medium text-foreground">{label}</span>
      <span className="shrink-0 text-xs text-secondary-text">{multiple ? limit ? localize(`多选 · 最多 ${limit} 项`, `Multiple · up to ${limit}`) : localize('多选', 'Multiple') : localize('单选', 'Single')}</span>
    </div>
    <div className={cn("rounded-[10px] border bg-background transition-colors", placement === "inline" && "overflow-hidden", open ? "border-primary/60" : "border-border")}>
      <button ref={trigger} type="button" value={!multiple ? selectedIds[0] || "" : undefined} aria-labelledby={`${id}-label`} aria-expanded={open} aria-controls={`${id}-choices`} disabled={disabled || loading} onClick={() => { if (open) close(); else setOpen(true); }}
        className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-hover/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50">
        <Tooltip content={selectedNames.join("、")} className="min-w-0 flex-1">
        <span className={cn("min-w-0 flex-1 truncate text-sm", selectedNames.length ? "text-foreground" : "text-secondary-text")}>
          {loading ? localize('正在读取…', 'Loading…') : selectedNames.length ? selectedNames.slice(0, 2).join(localize('、', ', ')) : placeholder}
        </span>
        </Tooltip>
        {multiple && selectedIds.length > 0 && <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{localize(`${selectedIds.length} 已选`, `${selectedIds.length} selected`)}</span>}
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-secondary-text transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && <div id={`${id}-choices`} className={placement === "above" ? "absolute inset-x-0 bottom-full z-50 mb-2 max-h-[50dvh] overflow-auto rounded-lg border border-border bg-card shadow-lg" : "border-t border-border/70"}>
        <div className="relative m-2">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-secondary-text" />
          <input ref={focusSearch} type="search" aria-label={localize(`搜索${label}`, `Search ${label}`)} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={localize('搜索名称或说明', 'Search names or descriptions')} className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary" />
        </div>
        <div role={multiple ? "group" : "radiogroup"} aria-label={localize(`${label}选项`, `${label} options`)} className="max-h-64 overflow-y-auto overscroll-contain divide-y divide-border/50 px-2">
          {filtered.map((item) => {
            const checked = selectedIds.includes(item.id);
            const blocked = disabled || Boolean(error) || item.disabled || (!checked && multiple && Boolean(limit && selectedIds.length >= limit));
            return <label key={item.id} className={cn("flex min-h-12 items-start gap-3 px-2 py-3 transition-colors", checked ? "bg-primary/5" : "hover:bg-hover/50", blocked ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
              <input type={multiple ? "checkbox" : "radio"} name={id} value={item.id} aria-label={item.name} checked={checked} disabled={blocked} onChange={() => { onSelect(item.id); if (!multiple) { close(); trigger.current?.focus(); } }} className="mt-0.5 h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-primary" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="text-sm font-medium text-foreground">{item.name}</span>{item.badge && <span className="text-xs text-secondary-text">{item.badge}</span>}</span>
                {item.description && <span className={cn("mt-1 block text-xs leading-5 text-secondary-text", !checked && "line-clamp-2")}>{item.description}</span>}
              </span>
            </label>;
          })}
          {!filtered.length && <p className="px-3 py-5 text-sm text-secondary-text">{keyword ? localize('没有匹配项，试试其他关键词。', 'No matches. Try another keyword.') : emptyText}</p>}
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-3 py-2 text-xs text-secondary-text">
          <span aria-live="polite">{limit && selectedIds.length >= limit ? localize(`已达 ${limit} 项上限，可取消后更换`, `Limit of ${limit} reached; remove one to change.`) : localize(`显示 ${filtered.length} 项${multiple ? ` · 已选 ${selectedIds.length} 项` : ""}`, `Showing ${filtered.length}${multiple ? ` · ${selectedIds.length} selected` : ""}`)}</span>
          <button type="button" onClick={() => { close(); trigger.current?.focus(); }} className="px-2 py-1 font-medium text-primary hover:underline">{localize('完成', 'Done')}</button>
        </div>
      </div>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-warning">{tx(error)}</p>}
  </div>;
}
