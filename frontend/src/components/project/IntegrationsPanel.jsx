import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, ShieldCheck, TriangleAlert, Webhook } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { ConfirmDialog } from '../ui/Modal.jsx';
import { Spinner } from '../ui/Feedback.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

function CopyButton({ value, label = 'Copy' }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Copy failed - select the value manually.');
    }
  }

  return (
    <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={copy}>
      {copied ? 'Copied' : label}
    </Button>
  );
}

/** One-time secret reveal. The value is never retrievable from the server again. */
function SecretReveal({ title, secret, note }) {
  return (
    <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p className="flex items-center gap-2 text-xs font-medium text-warning">
        <TriangleAlert size={14} aria-hidden="true" />
        {title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-canvas px-2.5 py-1.5 font-mono text-xs text-fg">
          {secret}
        </code>
        <CopyButton value={secret} />
      </div>
      <p className="mt-2 text-xs text-warning/90">{note}</p>
    </div>
  );
}

/**
 * GitHub webhook + event ingestion configuration. Secret values are shown
 * exactly once after rotation and are never returned by the API afterwards.
 */
export function IntegrationsPanel({ projectId, canManage = false }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'clearWebhook' | 'rotateIngest'
  const [revealedSecret, setRevealedSecret] = useState(null);
  const [revealedKey, setRevealedKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.get(`/projects/${projectId}/integrations`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function rotateWebhookSecret() {
    setRotating(true);
    try {
      const result = await api.post(`/projects/${projectId}/integrations/webhook-secret`);
      setRevealedSecret(result.secret);
      toast.success('New webhook secret generated');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRotating(false);
    }
  }

  async function clearWebhookSecret() {
    try {
      await api.delete(`/projects/${projectId}/integrations/webhook-secret`);
      setRevealedSecret(null);
      toast.success('Webhook secret removed - deliveries will now be rejected');
      setConfirm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function rotateIngestKey() {
    setRotating(true);
    try {
      const result = await api.post(`/projects/${projectId}/integrations/ingest-key`);
      setRevealedKey(result.key);
      toast.success('New ingest key generated');
      setConfirm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRotating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10" role="status">
        <Spinner size={22} />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
        {error}
      </p>
    );
  }

  const webhookUrl = `${window.location.origin}${status.webhookPath}`;

  return (
    <div className="space-y-6">
      {/* ------------------------------ GitHub ------------------------------ */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Webhook size={15} className="text-primary-300" aria-hidden="true" />
            GitHub webhook
          </h3>
          {status.webhookConfigured ? (
            <Badge tone="success" dot>
              Secret configured
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Not configured
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          Push events become commit events; deployment events become deployments. Pushes are never treated as
          successful deployments.
        </p>

        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-faint">Payload URL</span>
            <code className="min-w-0 flex-1 break-all rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-fg">
              {webhookUrl}
            </code>
            <CopyButton value={webhookUrl} />
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                loading={rotating}
                onClick={rotateWebhookSecret}
              >
                {status.webhookConfigured ? 'Rotate secret' : 'Generate secret'}
              </Button>
              {status.webhookConfigured && (
                <Button variant="dangerGhost" size="sm" onClick={() => setConfirm('clearWebhook')}>
                  Remove secret
                </Button>
              )}
            </div>
          )}

          {revealedSecret && (
            <SecretReveal
              title="Copy this secret into GitHub now"
              secret={revealedSecret}
              note="This is the only time the secret is shown. Requests signed with a different secret are rejected with 401."
            />
          )}
        </div>

        <div className="mt-4 rounded-lg border border-edge bg-surface-2/50 p-3">
          <p className="text-xs font-medium text-muted">Setup steps</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
            <li>
              In GitHub: repository <span className="text-fg">Settings → Webhooks → Add webhook</span>.
            </li>
            <li>
              Paste the payload URL above; set content type to <code className="text-accent-300">application/json</code>.
            </li>
            <li>Paste the generated secret.</li>
            <li>
              Select the <span className="text-fg">push</span> and{' '}
              <span className="text-fg">deployment / deployment status</span> events.
            </li>
            <li>
              Save. Duplicate deliveries are deduplicated by GitHub's delivery id; failed processing is recorded and
              recoverable.
            </li>
          </ol>
        </div>
      </section>

      {/* --------------------------- Event ingestion --------------------------- */}
      <section className="border-t border-edge pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <KeyRound size={15} className="text-accent-300" aria-hidden="true" />
            Event ingestion API
          </h3>
          {status.ingestKeyConfigured ? (
            <Badge tone="success" dot>
              Key …{status.ingestKeyLast4}
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              No key
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          Automation can authenticate with a signed-in JWT or with a project ingest key (stored hashed).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-faint">Endpoint</span>
          <code className="rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-fg">
            POST {status.eventsUrl}
          </code>
          <CopyButton value={`${window.location.origin}${status.eventsUrl}`} label="Copy URL" />
        </div>

        {canManage && (
          <div className="mt-3">
            <Button variant="secondary" size="sm" icon={ShieldCheck} onClick={() => setConfirm('rotateIngest')}>
              {status.ingestKeyConfigured ? 'Rotate ingest key' : 'Generate ingest key'}
            </Button>
          </div>
        )}

        {revealedKey && (
          <SecretReveal
            title="Copy this ingest key now"
            secret={revealedKey}
            note="Only a hash is stored server-side. Rotating invalidates the previous key immediately."
          />
        )}
      </section>

      <ConfirmDialog
        open={confirm === 'clearWebhook'}
        onClose={() => setConfirm(null)}
        onConfirm={clearWebhookSecret}
        title="Remove webhook secret"
        message="Incoming GitHub deliveries will be rejected until a new secret is generated and updated in GitHub."
        confirmLabel="Remove secret"
      />
      <ConfirmDialog
        open={confirm === 'rotateIngest'}
        onClose={() => setConfirm(null)}
        onConfirm={rotateIngestKey}
        title={status.ingestKeyConfigured ? 'Rotate ingest key' : 'Generate ingest key'}
        message={
          status.ingestKeyConfigured
            ? 'The current key stops working immediately. Update your automation with the new key.'
            : 'A new ingest key will be created and shown exactly once.'
        }
        confirmLabel={status.ingestKeyConfigured ? 'Rotate key' : 'Generate key'}
        danger={status.ingestKeyConfigured}
      />
    </div>
  );
}
