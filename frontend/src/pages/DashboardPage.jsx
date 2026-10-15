import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, RefreshCw, Rocket, ShieldAlert } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader.jsx';
import { DashboardContent } from '../components/dashboard/DashboardContent.jsx';
import { Button } from '../components/ui/Button.jsx';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [nonce, setNonce] = useState(0);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Metrics computed live from your projects' incidents, deployments and events."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={() => setNonce((n) => n + 1)}
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={FolderKanban}
              onClick={() => navigate('/projects?create=1')}
            >
              New project
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Rocket}
              onClick={() => navigate('/deployments?create=1')}
            >
              Record deployment
            </Button>
            <Button size="sm" icon={ShieldAlert} onClick={() => navigate('/incidents?create=1')}>
              Report incident
            </Button>
          </>
        }
      />
      <DashboardContent nonce={nonce} />
    </div>
  );
}
