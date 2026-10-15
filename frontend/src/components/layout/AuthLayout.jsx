import { Link, Outlet } from 'react-router-dom';
import { Activity } from 'lucide-react';

/**
 * Centered card layout for Login / Register. Ambient violet glow keeps the
 * auth screens on-brand without distracting from the form.
 */
export function AuthLayout() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(139,92,246,0.14),transparent_70%)]"
      />
      <div className="relative w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-lg shadow-primary-700/40">
            <Activity size={18} aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-fg">BuildTrace</span>
        </Link>
        <Outlet />
        <p className="mt-6 text-center text-xs text-faint">
          Incident tracking &amp; deployment monitoring for engineering teams
        </p>
      </div>
    </div>
  );
}
