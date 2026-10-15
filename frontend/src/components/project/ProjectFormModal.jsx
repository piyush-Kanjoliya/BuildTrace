import { useEffect, useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Input, Textarea } from '../ui/Field.jsx';
import { Modal } from '../ui/Modal.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

const EMPTY = { name: '', description: '', repositoryUrl: '', environments: 'production', members: '' };

function parseList(text) {
  return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Create-project dialog. Initial members are optional; the API reports any
 * emails that could not be matched to a registered user.
 */
export function ProjectFormModal({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setErrors({});
    }
  }, [open]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const environments = parseList(form.environments);
    if (environments.length === 0) {
      setErrors({ environments: 'At least one environment is required' });
      return;
    }
    setSaving(true);
    setErrors({});
    const members = parseList(form.members).map((email) => ({ email, role: 'developer' }));
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      repositoryUrl: form.repositoryUrl.trim(),
      environments,
    };
    if (members.length) payload.members = members;

    try {
      const result = await api.post('/projects', payload);
      const skipped = result.skippedMembers || [];
      toast.success(`Project "${result.project.name}" created`);
      if (skipped.length) {
        toast.info(`Skipped (no registered user): ${skipped.join(', ')}`);
      }
      onCreated(result.project);
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
      title="New project"
      subtitle="You become the project admin. Members must already have a BuildTrace account."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving} data-autofocus>
            Cancel
          </Button>
          <Button type="submit" form="project-form" loading={saving}>
            Create project
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            required
            value={form.name}
            onChange={set('name')}
            error={errors.name}
            placeholder="Checkout Platform"
          />
          <Input
            label="Repository URL"
            type="url"
            value={form.repositoryUrl}
            onChange={set('repositoryUrl')}
            error={errors.repositoryUrl}
            placeholder="https://github.com/org/repo"
          />
        </div>
        <Textarea
          label="Description"
          rows={2}
          value={form.description}
          onChange={set('description')}
          error={errors.description}
          placeholder="What does this project own?"
        />
        <Input
          label="Environments"
          required
          value={form.environments}
          onChange={set('environments')}
          error={errors.environments}
          hint="Comma separated, e.g. production, staging, preview"
        />
        <Textarea
          label="Initial members (optional)"
          rows={2}
          value={form.members}
          onChange={set('members')}
          error={errors.members}
          placeholder="maya@company.com, leo@company.com"
          hint="Registered emails only, added as developers. Manage roles later in project settings."
        />
      </form>
    </Modal>
  );
}
