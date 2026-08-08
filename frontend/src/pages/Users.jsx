import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { Modal, Loading, formatDateTime } from '../components/Common.jsx';

const emptyForm = { username: '', password: '', name: '', roleId: '', email: '', phone: '' };

const Users = () => {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api.get('/users'),
        api.get('/roles'),
      ]);
      setUsers(usersRes.data.data);
      setRoles(rolesRes.data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditing(user);
    setForm({
      username: user.username,
      password: '',
      name: user.name,
      roleId: user.role_id,
      email: user.email || '',
      phone: user.phone || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        const payload = {
          name: form.name,
          roleId: form.roleId,
          email: form.email,
          phone: form.phone,
        };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${editing.id}`, payload);
        toast.success('User updated');
      } else {
        await api.post('/users', form);
        toast.success('User created');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user) => {
    try {
      await api.put(`/users/${user.id}`, { isActive: !user.is_active });
      toast.success(user.is_active ? 'User disabled' : 'User enabled');
      loadData();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/users/${resetUser.id}/reset-password`, { newPassword });
      toast.success('Password reset successfully');
      setResetUser(null);
      setNewPassword('');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Delete user "${user.name}"?`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.success('User deleted');
      loadData();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <section className="view active" id="view-users">
      <div className="view-header">
        <div>
          <h2>Users</h2>
          <p>Manage system users and access</p>
        </div>
        <button className="btn" onClick={openCreate}>Add User</button>
      </div>

      {loading ? <Loading /> : (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Username</th>
                <th>Role</th>
                <th>Last Login</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>{user.id}</div>
                  </td>
                  <td>{user.username}</td>
                  <td><span className="pill">{user.role_name}</span></td>
                  <td>{user.last_login ? formatDateTime(user.last_login) : 'Never'}</td>
                  <td>
                    <span className={`pill ${user.is_active ? 'ok' : 'bad'}`}>
                      {user.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button onClick={() => openEdit(user)}>Edit</button>
                    <button onClick={() => { setResetUser(user); setNewPassword(''); }}>Reset Password</button>
                    <button onClick={() => toggleActive(user)}>
                      {user.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => handleDelete(user)}>Delete</button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan="6" className="empty-state">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal
          title={editing ? 'Edit User' : 'Add New User'}
          onClose={() => setShowModal(false)}
        >
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                required
              />
            </div>
            <div className="field-grid">
              <div className="field">
                <label>Username *</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setField('username', e.target.value)}
                  disabled={!!editing}
                  required
                />
              </div>
              <div className="field">
                <label>Role *</label>
                <select
                  value={form.roleId}
                  onChange={(e) => setField('roleId', e.target.value)}
                  required
                >
                  <option value="">Select role</option>
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>{editing ? 'New Password (leave blank to keep current)' : 'Password *'}</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                required={!editing}
              />
            </div>
            <div className="field-grid">
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Phone</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Saving...' : editing ? 'Update User' : 'Create User'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {resetUser && (
        <Modal title={`Reset Password - ${resetUser.name}`} onClose={() => setResetUser(null)}>
          <div className="field">
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 6 characters"
            />
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setResetUser(null)}>Cancel</button>
            <button className="btn" onClick={handleResetPassword} disabled={saving}>
              {saving ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
};

export default Users;