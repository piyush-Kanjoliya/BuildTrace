import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Input, Select, Textarea } from '../ui/Field.jsx';
import { Modal } from '../ui/Modal.jsx';
import { api } from '../../lib/api.js';
import { SEVERITIES } from '../../lib/constants.js';
import { useToast } from '../../context/ToastContext.jsx';

const EMPTY = {
  title: '',
  description: '',
  severity: 'SEV3',
  environment: '',
  affectedService: '',
  assigneeId: '',
};

/**
 * Create / edit incident dialog.
 *
 * Create mode works both scoped (project detail passes `projectId`) and
 * global (the Incidents page passes `projects`; the user picks one first).
 * Edits send the incident `version` so concurrent changes surface as a 409,
 * which we explain and auto-refresh.
 */
export function IncidentFormModal({
  open,
  onClose,
  onSaved,
  projectId = null,
  projects = [],
  environments = [],
  members = [],
  incident = null,
}) {
  const editing = Boolean(incident);
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || '');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const activeProject = useMemo(
    () => projects.find((p) => p._id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  // Scoped mode uses the passed environment list; global mode derives it
  // from the chosen project.
  const envList = projectId ? environments : activeProject?.environments || [];
  const envKey = envList.join('|');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSelectedProjectId(projectId || '');
    setForm(
      editing
        ? {
            title: incident.title || '',
            description: incident.description || '',
            severity: incident.severity || 'SEV3',
            environment: incident.environment || '',
            affectedService: incident.affectedService || '',
            assigneeId: incident.assigneeId?._id || incident.assigneeId || '',
          }
        : { ...EMPTY, environment: envList[0] || '' }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, incident, projectId]);

  // Fill the environment once the project context / options are available
  useEffect(() => {
    if (open && !editing && !form.environment && envList.length) {
      setForm((f) => ({ ...f, environment: envList[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, envKey, form.environment]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // Project environments plus the current value if it was renamed later
  const envOptions = [...new Set([...envList, form.environment].filter(Boolean))];
  const targetProjectId = projectId || selectedProjectId;

  async function submit(e) {
    e.preventDefault();
    if (!editing && !targetProjectId) {
      setErrors({ projectId: 'Choose a project first' });
      return;
    }
    setSaving(true);
    setErrors({});
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      severity: form.severity,
      environment: form.environment || null,
      affectedService: form.affectedService.trim() || null,
      assigneeId: form.assigneeId || null,
    };
    try {
      let result;
      if (editing) {
        result = await api.patch(`/incidents/${incident._id}`, { version: incident.version, ...payload });
        toast.success('Incident updated');
      } else {
        result = await api.post(`/projects/${targetProjectId}/incidents`, payload);
        toast.success('Incident created - candidate deployments are ready to review');
      }
      onSaved(result);
      onClose();
    } catch (err) {
      if (err.status === 409) {
        toast.error(`${err.message} The newest version has been loaded.`);
        onSaved(null);
        onClose();
      } else if (err.status === 422 || err.status === 400) {
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
      title={editing ? 'Edit incident' : 'New incident'}
      subtitle={
        editing
          ? 'Saving uses optimistic concurrency - your edit is rejected if someone changed the incident first.'
          : 'After creation, the correlation engine suggests candidate deployments you can review.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving} data-autofocus>
            Cancel
          </Button>
          <Button type="submit" form="incident-form" loading={saving}>
            {editing ? 'Save changes' : 'Create incident'}
          </Button>
        </>
      }
    >
      <form id="incident-form" onSubmit={submit} className="space-y-4">
        {!editing && !projectId && (
          <Select
            label="Project"
            required
            value={selectedProjectId}
            onChange={(e) => {
              setSelectedProjectId(e.target.value);
              setForm((f) => ({ ...f, environment: '', assigneeId: '' }));
            }}
            error={errors.projectId}
            hint="The incident is created inside this project."
          >
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          label="Title"
          required
          value={form.title}
          onChange={set('title')}
          error={errors.title}
          placeholder="Checkout API returning 500s in production"
        />
        <Textarea
          label="Description"
          rows={5}
          value={form.description}
          onChange={set('description')}
          error={errors.description}
          placeholder="What is broken, what is the impact, what do you know so far?"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Severity"
            required
            value={form.severity}
            onChange={set('severity')}
            error={errors.severity}
          >
            {SEVERITIES.map((sev) => (
              <option key={sev} value={sev}>
                {sev}
              </option>
            ))}
          </Select>
          {envOptions.length ? (
            <Select
              label="Environment"
              value={form.environment}
              onChange={set('environment')}
              error={errors.environment}
              hint={editing ? undefined : 'Used by the correlation engine to match deployments.'}
            >
              <option value="">Not set</option>
              {envOptions.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              label="Environment"
              value={form.environment}
              onChange={set('environment')}
              error={errors.environment}
              placeholder="production"
            />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Affected service"
            value={form.affectedService}
            onChange={set('affectedService')}
            error={errors.affectedService}
            placeholder="checkout-api"
          />
          <Select
            label="Assignee"
            value={form.assigneeId}
            onChange={set('assigneeId')}
            error={errors.assigneeId}
            disabled={!editing && members.length === 0}
            hint={!editing && members.length === 0 ? 'You are assigned by default.' : undefined}
          >
            <option value="">{editing ? 'Unassigned' : 'Assign to me'}</option>
            {members.map((m) => {
              const u = m.user || m;
              return (
                <option key={u._id} value={u._id}>
                  {u.name} ({m.role || 'member'})
                </option>
              );
            })}
          </Select>
        </div>
      </form>
    </Modal>
  );
}
