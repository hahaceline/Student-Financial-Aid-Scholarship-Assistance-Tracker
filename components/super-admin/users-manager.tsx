'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/dashboard/status-badge';
import { api } from '@/lib/client-api';
import { formatDate } from '@/lib/utils';
import { ROLE_LABELS, type AdminRole, type Profile } from '@/lib/types';

type AssignableRole = Exclude<AdminRole, 'SUPER_ADMIN'>;

export function UsersManager({ users, currentUserId }: { users: Profile[]; currentUserId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'invite' | 'password'>('invite');
  const [role, setRole] = useState<AssignableRole>('WORKING_SCHOLAR_ADMIN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<Profile | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const res = await api('/api/admin-users', 'POST', {
      full_name: f.get('full_name'), email: f.get('email'), role, mode, password: mode === 'password' ? f.get('password') : undefined,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setOpen(false);
    setNotice(mode === 'invite' ? 'Invitation sent. The new user sets their own password from the email link.' : 'Account created. Share the temporary password securely.');
    router.refresh();
  }

  async function toggle() {
    if (!target) return;
    setBusy(true); setError(null);
    const res = await api('/api/admin-users', 'PATCH', { id: target.id, is_active: !target.is_active });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setNotice(`${target.full_name} is now ${target.is_active ? 'deactivated' : 'active'}.`);
    setTarget(null);
    router.refresh();
  }

  return (
    <>
      {notice && <p role="status" className="mb-4 rounded-lg bg-brand-light p-3 text-sm text-brand-deep">{notice}</p>}
      <div className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">User accounts ({users.length})</h2>
          <button type="button" className="btn-primary btn-sm" onClick={() => { setError(null); setRole('WORKING_SCHOLAR_ADMIN'); setOpen(true); }}>
            <Plus className="h-4 w-4" />Add user
          </button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th className="text-right">Action</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.full_name}{u.id === currentUserId && <span className="ml-2 text-xs text-muted">(you)</span>}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td><Badge tone={u.is_active ? 'green' : 'slate'}>{u.is_active ? 'Active' : 'Deactivated'}</Badge></td>
                  <td>{formatDate(u.created_at)}</td>
                  <td className="text-right">
                    {u.role !== 'SUPER_ADMIN' && u.id !== currentUserId ? (
                      <button type="button" className="btn-secondary btn-sm" onClick={() => { setError(null); setTarget(u); }}>
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    ) : <span className="text-xs text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Add user account">
        <form onSubmit={create} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div><label className="label" htmlFor="full_name">Full name</label><input id="full_name" name="full_name" required className="input" /></div>
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required className="input" /></div>
          <div><label className="label" htmlFor="role">Role</label>
            <select id="role" className="input" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
              <option value="ACADEMIC_ADMIN">Academic Admin</option>
              <option value="WORKING_SCHOLAR_ADMIN">Working Scholar Admin</option>
              <option value="FINANCE_ADMIN">Finance Admin</option>
              <option value="STUDENT">Student</option>
            </select>
          </div>
          <fieldset>
            <legend className="label">How should they get access?</legend>
            <label className="mb-2 flex items-start gap-2 text-sm"><input type="radio" className="mt-1" checked={mode === 'invite'} onChange={() => setMode('invite')} />
              <span>Send an invitation email <span className="block text-xs text-muted">They choose their own password. Requires Supabase email to be set up.</span></span></label>
            <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1" checked={mode === 'password'} onChange={() => setMode('password')} />
              <span>Create with a temporary password <span className="block text-xs text-muted">You share the password with them securely.</span></span></label>
          </fieldset>
          {mode === 'password' && (
            <div><label className="label" htmlFor="password">Temporary password</label>
              <input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required className="input" />
              <p className="mt-1 text-xs text-muted">At least 10 characters.</p></div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create account</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!target} loading={busy} error={error} danger={!!target?.is_active}
        title={target?.is_active ? 'Deactivate this account?' : 'Activate this account?'}
        message={target?.is_active
          ? `${target?.full_name} will lose access to the administrator area immediately.`
          : `${target?.full_name} will be able to sign in again.`}
        confirmLabel={target?.is_active ? 'Deactivate' : 'Activate'}
        onConfirm={toggle} onCancel={() => setTarget(null)}
      />
    </>
  );
}
