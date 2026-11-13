import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { Modal, Loading, formatDate } from '../components/Common.jsx';

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
};

const Customers = () => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      const response = await api.get('/customers', { params });
      setCustomers(response.data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (customer) => {
    setEditing(customer);
    setForm({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/customers/${editing.id}`, form);
        toast.success('Customer updated');
      } else {
        await api.post('/customers', form);
        toast.success('Customer created');
      }
      setShowModal(false);
      loadCustomers();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (customer) => {
    if (!window.confirm(`Delete customer "${customer.name}"?`)) return;
    try {
      await api.delete(`/customers/${customer.id}`);
      toast.success('Customer deleted');
      loadCustomers();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <section className="view active" id="view-customers">
      <div className="view-header">
        <div>
          <h2>Customers</h2>
          <p>Manage your customer records</p>
        </div>
        <button className="btn" onClick={openCreate}>Add Customer</button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? <Loading /> : (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Address</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map(customer => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.name}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>{customer.id}</div>
                  </td>
                  <td>{customer.phone || '-'}</td>
                  <td>{customer.email || '-'}</td>
                  <td>{customer.address || '-'}</td>
                  <td>{formatDate(customer.created_at)}</td>
                  <td className="row-actions">
                    <button onClick={() => openEdit(customer)}>Edit</button>
                    <button onClick={() => handleDelete(customer)}>Delete</button>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan="6" className="empty-state">No customers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal
          title={editing ? 'Edit Customer' : 'Add New Customer'}
          onClose={() => setShowModal(false)}
        >
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Customer Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                required
              />
            </div>
            <div className="field-grid">
              <div className="field">
                <label>Phone</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label>Address</label>
              <textarea
                rows="2"
                value={form.address}
                onChange={(e) => setField('address', e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Saving...' : editing ? 'Update Customer' : 'Create Customer'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
};

export default Customers;