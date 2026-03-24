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
      'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-grok-recon-blue disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
      primary:
        'bg-[rgba(88,166,255,0.1)] text-grok-recon-blue border border-[rgba(88,166,255,0.3)] hover:bg-[rgba(88,166,255,0.15)] active:bg-[rgba(88,166,255,0.2)]',
      secondary:
        'bg-grok-surface-2 text-grok-text-body hover:bg-grok-surface-3 border border-grok-border hover:text-grok-text-heading',
      danger:
        'bg-[rgba(248,81,73,0.1)] text-grok-error border border-[rgba(248,81,73,0.3)] hover:bg-[rgba(248,81,73,0.15)] active:bg-[rgba(248,81,73,0.2)]',
      ghost:
        'text-grok-text-body border border-grok-border hover:bg-grok-hover hover:text-grok-text-heading',
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
