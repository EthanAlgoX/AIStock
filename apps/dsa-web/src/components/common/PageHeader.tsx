import type React from 'react';
import { cn } from '../../utils/cn';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}) => {
  return (
    <header className={cn('page-command-header', className)}>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow ? <span className="label-uppercase">{eyebrow}</span> : null}
          <h1 className={cn('text-2xl font-semibold tracking-[-0.025em] text-foreground md:text-[1.875rem]', eyebrow && 'mt-2')}>{title}</h1>
          {description ? <p className="mt-2 max-w-[65ch] text-sm leading-6 text-secondary-text">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
};
