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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <span className="label-uppercase">{eyebrow}</span> : null}
          <h1 className={cn('text-2xl font-semibold leading-tight tracking-[-0.025em] text-foreground md:text-[1.75rem]', eyebrow && 'mt-2')}>{title}</h1>
          {description ? <p className="mt-2 max-w-[65ch] text-sm leading-6 text-secondary-text">{description}</p> : null}
        </div>
        {actions ? <div className="page-command-actions">{actions}</div> : null}
      </div>
    </header>
  );
};
