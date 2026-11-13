import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { Modal, Loading, formatCurrency, formatDateTime, Pagination } from '../components/Common.jsx';

const Purchases = () => {
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailPurchase, setDetailPurchase] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('');

  const [form, setForm] = useState({
    supplierId: '',
    discount: 0,
    tax: 0,
    paidAmount: 0,
    notes: '',
    items: [{ productId: '', quantity: 1, purchasePrice: '', expiryDate: '' }],
  });

  const loadPurchases = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (paymentStatus) params.paymentStatus = paymentStatus;
      
      const [purchasesRes, suppliersRes, productsRes] = await Promise.all([
        api.get('/purchases', { params }),
        api.get('/suppliers'),
        api.get('/products'),
      ]);
      
      setPurchases(purchasesRes.data.data);
      setPagination(purchasesRes.data.pagination);
      setSuppliers(suppliersRes.data.data);
      setProducts(productsRes.data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, paymentStatus]);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  const openCreate = () => {
    setForm({
      supplierId: '',
      discount: 0,
      tax: 0,
      paidAmount: 0,
      notes: '',
      items: [{ productId: '', quantity: 1, purchasePrice: '', expiryDate: '' }],
    });
    setShowModal(true);
  };

  const addItem = () => {
    setForm(prev => ({
      ...prev,
      items: [...prev.items, { productId: '', quantity: 1, purchasePrice: '', expiryDate: '' }],
    }));
  };

  const removeItem = (index) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const updateItem = (index, field, value) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, [field]: value } : item),
    }));
  };

  const selectProduct = (index, productId) => {
    const product = products.find(p => p.id === productId);
    setForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index
          ? { ...item, productId, purchasePrice: product ? product.purchase_price : '' }
          : item
      ),
    }));
  };

  const calculateSubtotal = () => {
    return form.items.reduce((sum, item) => sum + (parseFloat(item.purchasePrice) || 0) * (parseInt(item.quantity) || 0), 0);
  };

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    return subtotal - (parseFloat(form.discount) || 0) + (parseFloat(form.tax) || 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        supplierId: form.supplierId,
        discount: parseFloat(form.discount) || 0,
        tax: parseFloat(form.tax) || 0,
        paidAmount: parseFloat(form.paidAmount) || 0,
        notes: form.notes,
        items: form.items.map(item => ({
          productId: item.productId,
          quantity: parseInt(item.quantity),
          purchasePrice: parseFloat(item.purchasePrice),
          expiryDate: item.expiryDate,
        })),
      };

      await api.post('/purchases', payload);
      toast.success('Purchase created successfully');
      setShowModal(false);
      loadPurchases();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const viewPurchase = async (purchase) => {
    setDetailLoading(true);
    setDetailPurchase(purchase);
    try {
      const response = await api.get(`/purchases/${purchase.id}`);
      setDetailPurchase(response.data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (purchase) => {
    const reason = window.prompt('Please provide a reason for deleting this purchase:');
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error('A reason is required to delete a purchase');
      return;
    }
    
    if (!window.confirm(`Delete purchase ${purchase.id}? This will reverse all stock.`)) return;
    
    try {
      await api.delete(`/purchases/${purchase.id}`, { data: { reason } });
      toast.success('Purchase deleted');
      loadPurchases();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <section className="view active" id="view-purchases">
      <div className="view-header">
        <div>
          <h2>Purchases</h2>
          <p>Manage purchase orders and supplier stock</p>
        </div>
        <button className="btn" onClick={openCreate}>New Purchase</button>
      </div>

      <div className="toolbar">
        <select
          value={paymentStatus}
          onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }}
        >
          <option value="">All payment statuses</option>
          <option value="Paid">Paid</option>
          <option value="Partial">Partial</option>
          <option value="Unpaid">Unpaid</option>
        </select>
      </div>

      {loading ? <Loading /> : (
        <>
          <div className="panel" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>PO #</th>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {purchases.map(purchase => (
                  <tr key={purchase.id}>
                    <td><strong>{purchase.id}</strong></td>
                    <td>{formatDateTime(purchase.created_at)}</td>
                    <td>{purchase.supplier_name}</td>
                    <td>{formatCurrency(purchase.grand_total)}</td>
                    <td>{formatCurrency(purchase.paid_amount)}</td>
                    <td>
                      <span className={`pill ${purchase.payment_status === 'Paid' ? 'ok' : purchase.payment_status === 'Partial' ? 'low' : 'bad'}`}>
                        {purchase.payment_status}
                      </span>
                    </td>
                    <td className="row-actions">
                      <button onClick={() => viewPurchase(purchase)}>View</button>
                      <button onClick={() => handleDelete(purchase)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {purchases.length === 0 && (
                  <tr><td colSpan="7" className="empty-state">No purchases found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={pagination?.totalPages || 1} onChange={setPage} />
        </>
      )}

      {/* Create purchase modal */}
      {showModal && (
        <Modal
          title="New Purchase Order"
          onClose={() => setShowModal(false)}
        >
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit(e); }}>
            <div className="field">
              <label>Supplier *</label>
              <select
                value={form.supplierId}
                onChange={(e) => setForm(prev => ({ ...prev, supplierId: e.target.value }))}
                required
              >
                <option value="">Select supplier</option>
                {suppliers.map(sup => (
                  <option key={sup.id} value={sup.id}>{sup.name}</option>
                ))}
              </select>
            </div>

            <h3 style={{ margin: '16px 0 8px', fontSize: '14.5px' }}>Items</h3>
            {form.items.map((item, index) => (
              <div key={index} style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '13px' }}>Item {index + 1}</strong>
                  {form.items.length > 1 && (
                    <button type="button" className="btn small secondary" onClick={() => removeItem(index)}>
                      Remove
                    </button>
                  )}
                </div>
                <div className="field">
                  <label>Product *</label>
                  <select
                    value={item.productId}
                    onChange={(e) => selectProduct(index, e.target.value)}
                    required
                  >
                    <option value="">Select product</option>
                    {products.map(product => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field-grid">
                  <div className="field">
                    <label>Quantity *</label>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Purchase Price ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.purchasePrice}
                      onChange={(e) => updateItem(index, 'purchasePrice', e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Expiry Date *</label>
                  <input
                    type="date"
                    value={item.expiryDate}
                    onChange={(e) => updateItem(index, 'expiryDate', e.target.value)}
                    required
                  />
                </div>
              </div>
            ))}

            <button type="button" className="btn secondary" onClick={addItem}>
              Add Item
            </button>

            <div className="field-grid" style={{ marginTop: '16px' }}>
              <div className="field">
                <label>Discount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.discount}
                  onChange={(e) => setForm(prev => ({ ...prev, discount: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Tax ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.tax}
                  onChange={(e) => setForm(prev => ({ ...prev, tax: e.target.value }))}
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Amount Paid ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.paidAmount}
                  onChange={(e) => setForm(prev => ({ ...prev, paidAmount: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>

            <div style={{ marginTop: '16px' }}>
              <div className="cart-total-row"><span>Subtotal</span><span>{formatCurrency(calculateSubtotal())}</span></div>
              <div className="cart-total-row grand"><span>Total</span><span>{formatCurrency(calculateTotal())}</span></div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Creating...' : 'Create Purchase'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Purchase detail modal */}
      {detailPurchase && (
        <Modal title={`Purchase ${detailPurchase.id}`} onClose={() => setDetailPurchase(null)}>
          {detailLoading ? <Loading /> : (
            <div>
              <div className="field-grid">
                <div className="field">
                  <label>Supplier</label>
                  <div>{detailPurchase.supplier_name}</div>
                </div>
                <div className="field">
                  <label>Date</label>
                  <div>{formatDateTime(detailPurchase.created_at)}</div>
                </div>
                <div className="field">
                  <label>Created By</label>
                  <div>{detailPurchase.created_by_name}</div>
                </div>
                <div className="field">
                  <label>Payment Status</label>
                  <div>{detailPurchase.payment_status}</div>
                </div>
              </div>

              {detailPurchase.supplier_phone && (
                <div className="field">
                  <label>Supplier Contact</label>
                  <div>{detailPurchase.supplier_phone} · {detailPurchase.supplier_email}</div>
                </div>
              )}

              <h3 style={{ margin: '14px 0 8px', fontSize: '14.5px' }}>Items</h3>
              <div className="panel" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Cost</th>
                      <th>Selling</th>
                      <th>Expiry</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailPurchase.items?.map((item) => (
                      <tr key={item.id}>
                        <td>{item.product_name}</td>
                        <td>{item.quantity}</td>
                        <td>{formatCurrency(item.purchase_price)}</td>
                        <td>{formatCurrency(item.selling_price)}</td>
                        <td>{formatDateTime(item.expiry_date)}</td>
                        <td>{formatCurrency(item.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '16px' }}>
                <div className="cart-total-row"><span>Subtotal</span><span>{formatCurrency(detailPurchase.subtotal)}</span></div>
                <div className="cart-total-row"><span>Discount</span><span>-{formatCurrency(detailPurchase.discount)}</span></div>
                <div className="cart-total-row"><span>Tax</span><span>{formatCurrency(detailPurchase.tax)}</span></div>
                <div className="cart-total-row grand"><span>Total</span><span>{formatCurrency(detailPurchase.grand_total)}</span></div>
                <div className="cart-total-row"><span>Paid</span><span>{formatCurrency(detailPurchase.paid_amount)}</span></div>
                <div className="cart-total-row"><span>Balance Due</span><strong style={{ color: detailPurchase.balance_due > 0 ? 'var(--danger)' : 'var(--primary-dark)' }}>{formatCurrency(detailPurchase.balance_due)}</strong></div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </section>
  );
};

export default Purchases;