import { useNavigate } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';

/** Catch-all 404 - always offers a way back, never a dead end. */
export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-edge bg-surface-2">
        <Compass size={26} className="text-faint" aria-hidden="true" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-300">404</p>
        <h1 className="mt-1 text-xl font-semibold text-fg">This page does not exist</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          The link may be broken or the page may have moved. Head back to the dashboard to keep
          tracking builds, deployments and incidents.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button icon={Home} onClick={() => navigate('/')}>
          Back to dashboard
        </Button>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    </div>
  );
}
