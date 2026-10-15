import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button.jsx';
import { Input, Textarea } from '../ui/Field.jsx';
import { ConfirmDialog } from '../ui/Modal.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

function parseEnvironments(text) {
  return [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** Project metadata form + danger zone. Admin-only for both. */
export function ProjectSettingsForm({ project, canEdit = false, onSaved, onDeleted }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', repositoryUrl: '', environments: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!project) return;
    setForm({
      name: project.name || '',
      description: project.description || '',
      repositoryUrl: project.repositoryUrl || '',
      environments: (project.environments || []).join(', '),
    });
    setErrors({});
  }, [project]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const environments = parseEnvironments(form.environments);
    if (environments.length === 0) {
      setErrors({ environments: 'At least one environment is required' });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const updated = await api.patch(`/projects/${project._id}`, {
        name: form.name.trim(),
        description: form.description.trim(),
        repositoryUrl: form.repositoryUrl.trim(),
        environments,
      });
      toast.success('Project updated');
      onSaved(updated);
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

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/projects/${project._id}`);
      toast.success(`Project "${project.name}" deleted`);
      onDeleted();
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Project name"
            required
            value={form.name}
            onChange={set('name')}
            error={errors.name}
            disabled={!canEdit}
          />
          <Input
            label="Repository URL"
            type="url"
            value={form.repositoryUrl}
            onChange={set('repositoryUrl')}
            error={errors.repositoryUrl}
            placeholder="https://github.com/org/repo"
            disabled={!canEdit}
          />
        </div>
        <Textarea
          label="Description"
          rows={3}
          value={form.description}
          onChange={set('description')}
          error={errors.description}
          disabled={!canEdit}
        />
        <Input
          label="Environments"
          value={form.environments}
          onChange={set('environments')}
          error={errors.environments}
          hint="Comma separated, e.g. production, staging, preview"
          disabled={!canEdit}
        />
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" icon={Save} loading={saving}>
              Save changes
            </Button>
          </div>
        )}
      </form>

      {canEdit && (
        <div className="rounded-xl border border-danger/35 bg-danger/5 p-4">
          <h3 className="text-sm font-semibold text-danger">Danger zone</h3>
          <p className="mt-1 text-xs text-muted">
            Deleting a project permanently removes its deployments, incidents, events and comments. This cannot be
            undone.
          </p>
          <div className="mt-3">
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
              Delete project
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete project"
        message={`Permanently delete "${project?.name}" and all of its data (deployments, incidents, events, comments, audit history)? This cannot be undone.`}
        confirmLabel="Delete project"
        loading={deleting}
      />
    </div>
  );
}
