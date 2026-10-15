import { Loader2 } from 'lucide-react';
import { cx } from '../../lib/format.js';

const VARIANTS = {
  primary:
    'bg-primary-600 text-white hover:bg-primary-500 active:bg-primary-700 border border-primary-500/50 shadow-sm shadow-primary-700/30',
  secondary:
    'bg-surface-2 text-fg hover:bg-surface-3 border border-edge hover:border-edge-strong',
  ghost: 'bg-transparent text-muted hover:text-fg hover:bg-surface-2 border border-transparent',
  outline:
    'bg-transparent text-fg border border-edge-strong hover:border-primary-400 hover:text-primary-300',
  danger:
    'bg-danger-deep text-white hover:bg-danger border border-danger/40 shadow-sm shadow-danger-deep/30',
  dangerGhost:
    'bg-transparent text-danger border border-danger/40 hover:bg-danger/10 hover:border-danger',
};

const SIZES = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-base gap-2 rounded-lg',
};

/**
 * Button with semantic variants, loading state (disables + spinner), and
 * optional leading icon. Icon-only usage must pass an aria-label.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon = null,
  loading = false,
  disabled = false,
  className = '',
  children,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size] || SIZES.md,
        className
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon size={size === 'lg' ? 18 : 16} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
