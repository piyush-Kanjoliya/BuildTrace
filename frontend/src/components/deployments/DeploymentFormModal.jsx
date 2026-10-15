import { useEffect, useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Input, Select, Textarea } from '../ui/Field.jsx';
import { Modal } from '../ui/Modal.jsx';
import { api } from '../../lib/api.js';
import { DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_META } from '../../lib/constants.js';
import { useToast } from '../../context/ToastContext.jsx';

const EMPTY = {
  environment: '',
  version: '',
  commitSha: '',
  status: 'success',
  service: '',
  commitMessage: '',
  changedFiles: '',
  url: '',
  occurredAt: '',
};

function splitFiles(text) {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Manual deployment entry (CI/GitHub ingestion is separate). */
export function DeploymentFormModal({ open, onClose, onSaved, projects = [], fixedProjectId = null }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [projectId, setProjectId] = useState(fixedProjectId || '');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(EMPTY);
    setProjectId(fixedProjectId || '');
  }, [open, fixedProjectId]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const selectedProject = projects.find((p) => p._id === projectId) || null;
  const envOptions = selectedProject?.environments || [];

  // Default to the first environment of the chosen project
  useEffect(() => {
    if (open && envOptions.length && !form.environment) {
      setForm((f) => ({ ...f, environment: envOptions[0] }));
    }
  }, [open, envOptions, form.environment]);

  async function submit(e) {
    e.preventDefault();
    if (!projectId) {
      setErrors({ projectId: 'Choose a project first' });
      return;
    }
    setSaving(true);
    setErrors({});
    const payload = { environment: form.environment.trim() };
    if (form.version.trim()) payload.version = form.version.trim();
    if (form.commitSha.trim()) payload.commitSha = form.commitSha.trim();
    if (form.status) payload.status = form.status;
    if (form.service.trim()) payload.service = form.service.trim();
    if (form.commitMessage.trim()) payload.commitMessage = form.commitMessage.trim();
    const files = splitFiles(form.changedFiles);
    if (files.length) payload.changedFiles = files;
    if (form.url.trim()) payload.url = form.url.trim();
    if (form.occurredAt) payload.occurredAt = new Date(form.occurredAt).toISOString();

    try {
      const result = await api.post(`/projects/${projectId}/deployments`, payload);
      toast.success('Deployment recorded');
      onSaved(result);
      onClose();
    } catch (err) {
      if (err.status === 422 || err.status === 400) {
        const fieldErrors = err.fieldErrors;
        setErrors(fieldErrors);
        if (!Object.keys(fieldErrors).length) toast.error(err.message);
      } else {
        toast.error(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record deployment"
      subtitle="Manual entries are marked as the manual source. CI and GitHub activity arrives through the event pipeline."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving} data-autofocus>
            Cancel
          </Button>
          <Button type="submit" form="deployment-form" loading={saving}>
            Record deployment
          </Button>
        </>
      }
    >
      <form id="deployment-form" onSubmit={submit} className="space-y-4">
        {!fixedProjectId && (
          <Select
            label="Project"
            required
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setForm((f) => ({ ...f, environment: '' }));
            }}
            error={errors.projectId}
          >
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {envOptions.length ? (
            <Select
              label="Environment"
              required
              value={form.environment}
              onChange={set('environment')}
              error={errors.environment}
            >
              {envOptions.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              label="Environment"
              required
              value={form.environment}
              onChange={set('environment')}
              error={errors.environment}
              placeholder="production"
            />
          )}
          <Select label="Status" value={form.status} onChange={set('status')} error={errors.status}>
            {DEPLOYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DEPLOYMENT_STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Version"
            value={form.version}
            onChange={set('version')}
            error={errors.version}
            placeholder="2.14.0"
          />
          <Input
            label="Commit SHA"
            value={form.commitSha}
            onChange={set('commitSha')}
            error={errors.commitSha}
            placeholder="9f8e7d6 (7-64 hex chars)"
            hint="Optional, stored lowercase."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Service"
            value={form.service}
            onChange={set('service')}
            error={errors.service}
            placeholder="checkout-api"
          />
          <Input
            label="When it happened"
            type="datetime-local"
            value={form.occurredAt}
            onChange={set('occurredAt')}
            error={errors.occurredAt}
            hint="Leave empty to use the current time."
          />
        </div>
        <Textarea
          label="Commit message"
          rows={2}
          value={form.commitMessage}
          onChange={set('commitMessage')}
          error={errors.commitMessage}
          placeholder="Fix checkout timeout retry logic"
        />
        <Textarea
          label="Changed files"
          rows={3}
          value={form.changedFiles}
          onChange={set('changedFiles')}
          error={errors.changedFiles}
          placeholder={'src/checkout/retry.js\nsrc/checkout/client.js'}
          hint="One per line or comma separated. Used by the correlation engine's change-signal factor."
        />
        <Input
          label="Deployment URL"
          type="url"
          value={form.url}
          onChange={set('url')}
          error={errors.url}
          placeholder="https://ci.example.com/builds/1234"
        />
      </form>
    </Modal>
  );
}
