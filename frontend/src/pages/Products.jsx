import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { Modal, Loading, formatCurrency, formatDateTime } from '../components/Common.jsx';

const emptyForm = {
  name: '',
  categoryId: '',
  supplierId: '',
  purchasePrice: '',
  sellingPrice: '',
  taxRate: 0,
  reorderLevel: '',
  defaultMargin: 25,
  pillsPerUnit: 1,
  sellByPill: false,
};

const Products = () => {
  const { hasPermission } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailProduct, setDetailProduct] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lowStockFilter, setLowStockFilter] = useState(false);

  const canCreate = hasPermission('PERM_CREATE_PRODUCT');
  const canEdit = hasPermission('PERM_EDIT_PRODUCT');
  const canDelete = hasPermission('PERM_DELETE_PRODUCT');

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (lowStockFilter) params.lowStock = 'true';
      
      const [productsRes, categoriesRes, suppliersRes] = await Promise.all([
        api.get('/products', { params }),
        api.get('/categories'),
        api.get('/suppliers'),
      ]);
      
      setProducts(productsRes.data.data);
      setCategories(categoriesRes.data.data);
      setSuppliers(suppliersRes.data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, lowStockFilter]);

  useEffect(() => {
    const timer = setTimeout(() => loadProducts(), 300);
    return () => clearTimeout(timer);
  }, [loadProducts]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (product) => {
    setEditing(product);
    setForm({
      name: product.name,
      categoryId: product.category_id || '',
      supplierId: product.supplier_id || '',
      purchasePrice: product.purchase_price,
      sellingPrice: product.selling_price,
      taxRate: product.tax_rate || 0,
      reorderLevel: product.reorder_level || '',
      defaultMargin: product.default_margin || 25,
      pillsPerUnit: product.pills_per_unit || 1,
      sellByPill: product.sell_by_pill,
    });
    setShowModal(true);
  };

  const viewDetails = async (product) => {
    setDetailLoading(true);
    setDetailProduct({ ...product, batches: [] });
    try {
      const response = await api.get(`/products/${product.id}`);
      setDetailProduct(response.data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        categoryId: form.categoryId,
        supplierId: form.supplierId,
        purchasePrice: parseFloat(form.purchasePrice),
        sellingPrice: parseFloat(form.sellingPrice),
        taxRate: parseFloat(form.taxRate) || 0,
        reorderLevel: parseInt(form.reorderLevel) || 0,
        defaultMargin: parseFloat(form.defaultMargin) || 25,
        pillsPerUnit: parseInt(form.pillsPerUnit) || 1,
        sellByPill: form.sellByPill,
      };

      if (editing) {
        await api.put(`/products/${editing.id}`, payload);
        toast.success('Product updated');
      } else {
        await api.post('/products', payload);
        toast.success('Product created');
      }
      
      setShowModal(false);
      loadProducts();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product) => {
    if (!window.confirm(`Delete product "${product.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/products/${product.id}`);
      toast.success('Product deleted');
      loadProducts();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const setField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <section className="view active" id="view-products">
      <div className="view-header">
        <div>
          <h2>Products</h2>
          <p>Manage your product catalog, pricing, and inventory</p>
        </div>
        {canCreate && (
          <button className="btn" onClick={openCreate}>Add Product</button>
        )}
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
          <input
            type="checkbox"
            checked={lowStockFilter}
            onChange={(e) => setLowStockFilter(e.target.checked)}
          />
          Low stock only
        </label>
      </div>

      {loading ? <Loading /> : (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Purchase Price</th>
                <th>Selling Price</th>
                <th>Margin</th>
                <th>Stock</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>{product.id}</div>
                  </td>
                  <td>{product.category_name || '-'}</td>
                  <td>{formatCurrency(product.purchase_price)}</td>
                  <td>{formatCurrency(product.selling_price)}</td>
                  <td>{product.default_margin}%</td>
                  <td>
                    <span className={`pill ${product.isLowStock ? 'bad' : 'ok'}`}>
                      {product.sell_by_pill ? `${product.displayStock} pills` : `${product.displayStock} units`}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${product.is_active ? 'ok' : 'low'}`}>
                      {product.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button onClick={() => viewDetails(product)}>View</button>
                    {canEdit && <button onClick={() => openEdit(product)}>Edit</button>}
                    {canDelete && <button onClick={() => handleDelete(product)}>Delete</button>}
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan="8" className="empty-state">No products found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Product form modal */}
      {showModal && (
        <Modal
          title={editing ? 'Edit Product' : 'Add New Product'}
          onClose={() => setShowModal(false)}
        >
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Product Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                required
              />
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Category</label>
                <select
                  value={form.categoryId}
                  onChange={(e) => setField('categoryId', e.target.value)}
                >
                  <option value="">Select category</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Supplier</label>
                <select
                  value={form.supplierId}
                  onChange={(e) => setField('supplierId', e.target.value)}
                >
                  <option value="">Select supplier</option>
                  {suppliers.map(sup => (
                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Purchase Price ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.purchasePrice}
                  onChange={(e) => setField('purchasePrice', e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Selling Price ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.sellingPrice}
                  onChange={(e) => setField('sellingPrice', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Default Margin (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.defaultMargin}
                  onChange={(e) => setField('defaultMargin', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Reorder Level</label>
                <input
                  type="number"
                  min="0"
                  value={form.reorderLevel}
                  onChange={(e) => setField('reorderLevel', e.target.value)}
                  placeholder="e.g. 50"
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Tax Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.taxRate}
                  onChange={(e) => setField('taxRate', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Pills Per Unit</label>
                <input
                  type="number"
                  min="1"
                  value={form.pillsPerUnit}
                  onChange={(e) => setField('pillsPerUnit', e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal' }}>
                <input
                  type="checkbox"
                  checked={form.sellByPill}
                  onChange={(e) => setField('sellByPill', e.target.checked)}
                />
                Sell by pill (allow selling individual pills)
              </label>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Saving...' : editing ? 'Update Product' : 'Create Product'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Product detail modal */}
      {detailProduct && (
        <Modal
          title={detailProduct.name}
          onClose={() => setDetailProduct(null)}
        >
          {detailLoading ? <Loading /> : (
            <div>
              <div className="field-grid">
                <div className="field">
                  <label>ID</label>
                  <div>{detailProduct.id}</div>
                </div>
                <div className="field">
                  <label>Category</label>
                  <div>{detailProduct.category_name || '-'}</div>
                </div>
                <div className="field">
                  <label>Purchase Price</label>
                  <div>{formatCurrency(detailProduct.purchase_price)}</div>
                </div>
                <div className="field">
                  <label>Selling Price</label>
                  <div>{formatCurrency(detailProduct.selling_price)}</div>
                </div>
                <div className="field">
                  <label>Current Stock</label>
                  <div>
                    {detailProduct.sell_by_pill
                      ? `${detailProduct.displayStock} pills (${detailProduct.current_stock} units + ${detailProduct.loose_pills} loose)`
                      : `${detailProduct.current_stock} units`}
                  </div>
                </div>
                <div className="field">
                  <label>Reorder Level</label>
                  <div>{detailProduct.reorder_level || '-'}</div>
                </div>
                <div className="field">
                  <label>Last Updated</label>
                  <div>{formatDateTime(detailProduct.updated_at)}</div>
                </div>
              </div>

              <h3 style={{ margin: '14px 0 8px', fontSize: '14.5px' }}>Batches</h3>
              {detailProduct.batches?.length > 0 ? (
                <div className="panel" style={{ padding: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>Qty</th>
                        <th>Cost</th>
                        <th>Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailProduct.batches.map(batch => (
                        <tr key={batch.id}>
                          <td>{batch.id}</td>
                          <td>{batch.quantity}</td>
                          <td>{formatCurrency(batch.purchase_price)}</td>
                          <td>{formatDateTime(batch.expiry_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>No batches for this product</p>
              )}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
};

export default Products;