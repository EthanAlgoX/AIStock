import type React from 'react';
import { Bell, Bot, Database, Layers3, LineChart, Settings2, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '../common';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { getCategoryTitle } from '../../utils/systemConfigI18n';
import type { SystemConfigCategory, SystemConfigCategorySchema, SystemConfigItem } from '../../types/systemConfig';
import { cn } from '../../utils/cn';

interface SettingsCategoryNavProps {
  categories: SystemConfigCategorySchema[];
  itemsByCategory: Record<string, SystemConfigItem[]>;
  activeCategory: string;
  onSelect: (category: string) => void;
}

const categoryIconMap: Partial<Record<SystemConfigCategory, LucideIcon>> = {
  system: Settings2,
  base: SlidersHorizontal,
  data_source: Database,
  ai_model: Layers3,
  notification: Bell,
  agent: Bot,
  backtest: LineChart,
};

export const SettingsCategoryNav: React.FC<SettingsCategoryNavProps> = ({
  categories,
  itemsByCategory,
  activeCategory,
  onSelect,
}) => {
  const { language, t } = useUiLanguage();

  return (
    <nav
      className="min-w-0 border-b settings-border"
      aria-label={t('settings.categoryNavTitle')}
    >
      <div className="flex gap-1 overflow-x-auto">
        {categories.map((category) => {
          const isActive = category.category === activeCategory;
          const count = (itemsByCategory[category.category] || []).length;
          const title = getCategoryTitle(category.category, category.title, language);
          const Icon = categoryIconMap[category.category] ?? Layers3;

          return (
            <button
              key={category.category}
              type="button"
              aria-label={`${title} ${count}`}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-secondary-text hover:bg-hover hover:text-foreground',
              )}
              onClick={() => onSelect(category.category)}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon
                className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-text')}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm font-medium', isActive ? 'text-foreground' : 'text-secondary-text')}>
                  {title}
                </span>
              </span>
              <Badge
                variant={isActive ? 'info' : 'default'}
                size="sm"
                className={cn(
                  'shrink-0 px-1.5 py-0 text-[11px]',
                  isActive
                    ? 'settings-accent-badge border-[hsl(var(--primary)/0.32)]'
                    : 'border-[var(--settings-border)] bg-[var(--settings-surface)] text-muted-text',
                )}
              >
                {count}
              </Badge>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
