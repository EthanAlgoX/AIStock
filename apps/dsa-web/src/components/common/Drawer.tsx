import type React from 'react';
import { useEffect, useId, useRef } from 'react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { cn } from '../../utils/cn';

let activeDrawerCount = 0;
let previousBodyOverflow = '';

const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

function isVisible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (current instanceof HTMLDetailsElement && !current.open) {
      const summary = Array.from(current.children).find((child) => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
    current = current.parentElement;
  }
  return true;
}

function topmostDialog(): HTMLElement | undefined {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(isVisible);
  const layers = (dialog: HTMLElement): number[] => {
    let current: HTMLElement | null = dialog;
    const result: number[] = [];
    while (current) {
      const value = Number.parseInt(window.getComputedStyle(current).zIndex, 10);
      if (Number.isFinite(value)) result.unshift(value);
      current = current.parentElement;
    }
    return result;
  };
  // A dialog without a positioned layer follows document order. Drawers with
  // explicit layers respect their visual order even when rendered earlier.
  return dialogs.reduce<HTMLElement | undefined>((top, dialog) => {
    if (!top) return dialog;
    const topLayers = layers(top);
    const dialogLayers = layers(dialog);
    for (let index = 0; index < Math.min(topLayers.length, dialogLayers.length); index++) {
      if (dialogLayers[index] !== topLayers[index]) return dialogLayers[index] < topLayers[index] ? top : dialog;
    }
    if (topLayers.length && dialogLayers.length && dialogLayers.length < topLayers.length) return top;
    return dialog;
  }, undefined);
}

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
  zIndex?: number;
  side?: 'left' | 'right';
  backdropClassName?: string;
}

/**
 * Side drawer component with terminal-inspired styling.
 */
export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
  zIndex = 50,
  side = 'right',
  backdropClassName,
}) => {
  const { t } = useUiLanguage();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      let lastDrawerFocus: HTMLElement | null = null;
      const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => isVisible(element) && (!element.hasAttribute('tabindex') || element.tabIndex >= 0))
        .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const focusFirst = () => (focusable()[0] ?? dialog).focus();
      const handleFocus = (event: FocusEvent) => {
        if (event.target instanceof HTMLElement && dialog.contains(event.target)) lastDrawerFocus = event.target;
        if (topmostDialog() === dialog && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
      };
      const observer = new MutationObserver(() => {
        // A portal confirmation can remove its focused button without firing
        // focusin. Return to the drawer only after that higher dialog closes.
        if (!dialog.contains(document.activeElement) && topmostDialog() === dialog) {
          if (lastDrawerFocus?.isConnected && dialog.contains(lastDrawerFocus)) lastDrawerFocus.focus();
          else focusFirst();
        }
      });
      const handleKeyDown = (event: KeyboardEvent) => {
        if (topmostDialog() !== dialog) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeRef.current();
        } else if (event.key === 'Tab') {
          const elements = focusable();
          const first = elements[0];
          const last = elements.at(-1);
          if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last) || !dialog.contains(document.activeElement)) {
            event.preventDefault();
            (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
          }
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('focusin', handleFocus);
      observer.observe(document.body, { childList: true, subtree: true });
      activeDrawerCount++;
      if (activeDrawerCount === 1) {
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }
      if (topmostDialog() === dialog) focusFirst();

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('focusin', handleFocus);
        observer.disconnect();
        activeDrawerCount--;
        if (activeDrawerCount === 0) {
          document.body.style.overflow = previousBodyOverflow;
        }
        const top = topmostDialog();
        if (previousFocus?.isConnected && (!top || top === dialog || top.contains(previousFocus))) previousFocus.focus();
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sidePositionClass = side === 'left' ? 'left-0 justify-start' : 'right-0 justify-end';
  const borderClass = side === 'left' ? 'border-r' : 'border-l';

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ zIndex }} role="presentation">
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-300',
          backdropClassName,
        )}
        onClick={onClose}
      />

      <div className={cn('absolute inset-y-0 flex w-full', sidePositionClass, width)}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : t('common.details')}
          tabIndex={-1}
          ref={dialogRef}
          className={cn(
            'relative flex w-full flex-col bg-card',
            borderClass,
            side === 'right' ? 'border-border/80' : 'border-border/70 shadow-2xl',
            side === 'left' ? 'animate-slide-in-left' : 'animate-slide-in-right'
          )}
        >
          <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
            {title ? (
              <div>
                <h2 id={titleId} className="text-lg font-semibold text-foreground">{title}</h2>
              </div>
            ) : <div />}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border/70 bg-card/80 text-secondary-text transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t('common.closeDrawer')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
