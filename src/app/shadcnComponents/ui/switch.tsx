'use client';

import { cn } from '@/lib/utils';

type SwitchProps = {
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  title?: string;
  'aria-label'?: string;
  className?: string;
};

export function Switch({
  checked,
  indeterminate = false,
  onCheckedChange,
  disabled,
  id,
  title,
  'aria-label': ariaLabel,
  className,
}: SwitchProps) {
  const on = checked && !indeterminate;

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={indeterminate ? 'mixed' : on}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onCheckedChange(!on)}
      className={cn(
        'inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        on || indeterminate ? 'bg-primary' : 'bg-slate-300/90 dark:bg-input',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none block size-3.5 rounded-full shadow-sm transition-[transform,background-color]',
          on || indeterminate ? 'bg-white' : 'bg-white dark:bg-muted-foreground',
          indeterminate ? 'translate-x-[7px]' : on ? 'translate-x-[14px]' : 'translate-x-0'
        )}
      />
    </button>
  );
}
