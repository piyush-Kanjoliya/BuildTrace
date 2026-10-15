import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/format.js';

/**
 * Page-level header: breadcrumbs, title, description and right-aligned
 * actions. Used at the top of every main screen.
 */
export function PageHeader({
  breadcrumbs = [],
  title,
  description = null,
  actions = null,
  className = '',
  children = null,
}) {
  return (
    <div className={cx('mb-6', className)}>
      {breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
            {breadcrumbs.map((crumb, i) => (
              <li key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
                {crumb.to ? (
                  <Link to={crumb.to} className="cursor-pointer transition-colors hover:text-fg">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-muted">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {children}
    </div>
  );
}
