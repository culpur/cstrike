/**
 * Button Component - Grok-themed button with variants
 */

import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@utils/index';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grok-recon-blue disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
      primary:
        'bg-grok-recon-blue text-white hover:bg-blue-600 active:bg-blue-700',
      secondary:
        'bg-grok-surface-2 text-grok-text-body hover:bg-grok-surface-3 border border-grok-border',
      danger:
        'bg-grok-exploit-red text-white hover:bg-red-700 active:bg-red-800',
      ghost:
        'text-grok-text-body hover:bg-grok-surface-2 hover:text-grok-text-heading',
    };

    const sizes = {
      sm: 'h-8 px-3 text-sm rounded',
      md: 'h-10 px-4 text-sm rounded-md',
      lg: 'h-12 px-6 text-base rounded-md',
    };

    return (
      <button
        ref={ref}
        className={cn(
          baseStyles,
          variants[variant],
          sizes[size],
          isLoading && 'opacity-50 cursor-wait',
          className
        )}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {children}
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
