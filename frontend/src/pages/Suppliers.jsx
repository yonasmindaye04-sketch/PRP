import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { Modal, Loading, formatCurrency } from '../components/Common.jsx';

const emptyForm = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  taxNumber: '',
  paymentTerms: 30,
};

const Suppliers = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/suppliers');
      let data = response.data.data;
      if (search) {
        data = data.filter(s =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.contact_person?.toLowerCase().includes(search.toLowerCase()) ||
          s.phone?.includes(search)
        );
      }
      setSuppliers(data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (supplier) => {
    setEditing(supplier);
    setForm({
      name: supplier.name,
      contactPerson: supplier.contact_person || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      taxNumber: supplier.tax_number || '',
      paymentTerms: supplier.payment_terms || 30,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/suppliers/${editing.id}`, form);
        toast.success('Supplier updated');
      } else {
        await api.post('/suppliers', form);
        toast.success('Supplier created');
      }
      setShowModal(false);
      loadSuppliers();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (supplier) => {
    if (!window.confirm(`Delete supplier "${supplier.name}"?`)) return;
    try {
      await api.delete(`/suppliers/${supplier.id}`);
      toast.success('Supplier deleted');
      loadSuppliers();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <section className="view active" id="view-suppliers">
      <div className="view-header">
        <div>
          <h2>Suppliers</h2>
          <p>Manage your supplier relationships and balances</p>
        </div>
        <button className="btn" onClick={openCreate}>Add Supplier</button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search suppliers..."
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
                <th>Contact Person</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(supplier => (
                <tr key={supplier.id}>
                  <td>
                    <strong>{supplier.name}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>{supplier.id}</div>
                  </td>
                  <td>{supplier.contact_person || '-'}</td>
                  <td>{supplier.phone || '-'}</td>
                  <td>{supplier.email || '-'}</td>
                  <td>
                    <span className={`pill ${supplier.balance > 0 ? 'low' : 'ok'}`}>
                      {formatCurrency(supplier.balance)}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button onClick={() => openEdit(supplier)}>Edit</button>
                    <button onClick={() => handleDelete(supplier)}>Delete</button>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr><td colSpan="6" className="empty-state">No suppliers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal
          title={editing ? 'Edit Supplier' : 'Add New Supplier'}
          onClose={() => setShowModal(false)}
        >
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Supplier Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                required
              />
            </div>
            <div className="field-grid">
              <div className="field">
                <label>Contact Person</label>
                <input
                  type="text"
                  value={form.contactPerson}
                  onChange={(e) => setField('contactPerson', e.target.value)}
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
                <label>Tax Number</label>
                <input
                  type="text"
                  value={form.taxNumber}
                  onChange={(e) => setField('taxNumber', e.target.value)}
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
            <div className="field">
              <label>Payment Terms (days)</label>
              <input
                type="number"
                min="0"
                value={form.paymentTerms}
                onChange={(e) => setField('paymentTerms', e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Saving...' : editing ? 'Update Supplier' : 'Create Supplier'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
};

export default Suppliers;