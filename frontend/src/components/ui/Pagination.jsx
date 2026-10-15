import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../../lib/format.js';

/**
 * Pagination for server-driven lists. Always shows the current range and
 * total so users know where they are.
 */
export function Pagination({ page, limit = 20, total, onPageChange, className = '' }) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / limit));
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav
      aria-label="Pagination"
      className={cx('flex flex-wrap items-center justify-between gap-3 px-5 py-3', className)}
    >
      <p className="text-xs text-muted tabular">
        Showing <span className="text-fg">{from}</span>–<span className="text-fg">{to}</span> of{' '}
        <span className="text-fg">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-edge bg-surface-2 px-2.5 text-xs text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={14} aria-hidden="true" />
          Prev
        </button>
        <span className="px-1 text-xs text-muted tabular">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-edge bg-surface-2 px-2.5 text-xs text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
