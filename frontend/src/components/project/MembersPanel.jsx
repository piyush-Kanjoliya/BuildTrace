import { useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { Button } from '../ui/Button.jsx';
import { Input, Select } from '../ui/Field.jsx';
import { ConfirmDialog } from '../ui/Modal.jsx';
import { RoleBadge } from '../ui/Badge.jsx';
import { api } from '../../lib/api.js';
import { ROLES, ROLE_META } from '../../lib/constants.js';
import { initials, timeAgo } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Project membership: add by email, change roles, remove members.
 * Only project admins see the controls; everyone else gets a read-only list.
 */
export function MembersPanel({ project, canManage = false, onChanged }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(ROLES.DEVELOPER);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const members = project?.members || [];

  async function handleAdd(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const updated = await api.post(`/projects/${project._id}/members`, {
        email: email.trim(),
        role,
      });
      toast.success(`${email.trim()} added as ${ROLE_META[role].label}`);
      setEmail('');
      onChanged(updated);
    } catch (err) {
      // 404 user-not-found and 409 already-member both arrive here
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(member, newRole) {
    setBusyId(member.user?._id);
    try {
      const updated = await api.patch(`/projects/${project._id}/members/${member.user?._id}`, {
        role: newRole,
      });
      toast.success(`${member.user?.name || 'Member'} is now ${ROLE_META[newRole].label}`);
      onChanged(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove() {
    if (!pendingRemove) return;
    setRemoving(true);
    try {
      const updated = await api.delete(
        `/projects/${project._id}/members/${pendingRemove.user?._id}`
      );
      toast.success(`${pendingRemove.user?.name || 'Member'} removed`);
      setPendingRemove(null);
      onChanged(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">Team members</h3>
          <p className="mt-0.5 text-xs text-muted">
            {members.length} member{members.length === 1 ? '' : 's'} · roles are enforced server-side
          </p>
        </div>
      </div>

      {canManage && (
        <form onSubmit={handleAdd} className="mt-4 flex flex-wrap items-end gap-3">
          <Input
            label="Add by email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="min-w-[220px] flex-1"
            error={addError}
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-36"
          >
            {Object.values(ROLES).map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}
              </option>
            ))}
          </Select>
          <Button type="submit" icon={UserPlus} loading={adding} size="md">
            Add
          </Button>
        </form>
      )}

      <ul className="mt-4 divide-y divide-edge/60">
        {members.map((m) => {
          const u = m.user || {};
          return (
            <li key={u._id || m.user} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-semibold text-muted">
                {initials(u.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{u.name || 'Unknown user'}</p>
                <p className="truncate text-xs text-faint">
                  {u.email || '—'}
                  {m.addedAt ? ` · joined ${timeAgo(m.addedAt)}` : ''}
                </p>
              </div>
              {canManage ? (
                <Select
                  label=""
                  aria-label={`Role for ${u.name || 'member'}`}
                  value={m.role}
                  onChange={(e) => handleRoleChange(m, e.target.value)}
                  disabled={busyId === u._id}
                  className="w-36"
                >
                  {Object.values(ROLES).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_META[r].label}
                    </option>
                  ))}
                </Select>
              ) : (
                <RoleBadge role={m.role} />
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setPendingRemove(m)}
                  aria-label={`Remove ${u.name || 'member'}`}
                  className="cursor-pointer rounded-md p-2 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          );
        })}
        {members.length === 0 && (
          <li className="py-6 text-center text-sm text-faint">No members yet.</li>
        )}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onClose={() => setPendingRemove(null)}
        onConfirm={handleRemove}
        title="Remove member"
        message={`Remove ${pendingRemove?.user?.name || 'this member'} from ${project?.name}? They immediately lose access to this project's data.`}
        confirmLabel="Remove member"
        loading={removing}
      />
    </div>
  );
}
