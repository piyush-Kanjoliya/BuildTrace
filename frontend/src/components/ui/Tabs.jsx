import { cx } from '../../lib/format.js';

/**
 * Tab bar used inside project detail / settings. Keyboard navigable with
 * arrow keys; the active tab is highlighted (not color-only: it also gets a
 * violet underline and semibold text).
 */
export function Tabs({ tabs, active, onChange, className = '' }) {
  function onKeyDown(e) {
    const index = tabs.findIndex((t) => t.id === active);
    if (e.key === 'ArrowRight' && index < tabs.length - 1) {
      onChange(tabs[index + 1].id);
    } else if (e.key === 'ArrowLeft' && index > 0) {
      onChange(tabs[index - 1].id);
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Sections"
      onKeyDown={onKeyDown}
      className={cx('flex gap-1 overflow-x-auto border-b border-edge', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cx(
              'inline-flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm transition-colors',
              selected
                ? 'border-primary-500 font-semibold text-fg'
                : 'border-transparent text-muted hover:text-fg'
            )}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cx(
                  'rounded-full px-1.5 py-0.5 text-[10px] tabular',
                  selected ? 'bg-primary-500/20 text-primary-300' : 'bg-surface-3 text-muted'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
