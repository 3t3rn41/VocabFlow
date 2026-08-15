import { type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'grade';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'bg-brand-600 text-white hover:bg-brand-700': variant === 'primary',
          'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800': variant === 'ghost',
          'bg-red-500 text-white hover:bg-red-600': variant === 'danger',
          'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600':
            variant === 'grade',
        },
        { 'px-3 py-1.5 text-sm': size === 'sm' },
        { 'px-4 py-2': size === 'md' },
        { 'px-6 py-3 text-lg': size === 'lg' },
        className,
      )}
      {...props}
    />
  );
}
