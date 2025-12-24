/**
 * Input Component - Text input with Grok styling
 */

import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@utils/index';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, label, className, id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-grok-text-body mb-1.5"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full px-3 py-2 bg-grok-surface-2 border border-grok-border rounded-md',
            'text-grok-text-body placeholder:text-grok-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-grok-recon-blue focus:border-transparent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors',
            error && 'border-grok-error focus:ring-grok-error',
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-xs text-grok-error">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
