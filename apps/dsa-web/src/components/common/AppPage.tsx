import type React from 'react';
import { cn } from '../../utils/cn';

interface AppPageProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  className?: string;
}

export const AppPage: React.FC<AppPageProps> = ({ children, className = '', ...props }) => {
  return (
    <div className={cn('app-page', className)} {...props}>
      {children}
    </div>
  );
};
