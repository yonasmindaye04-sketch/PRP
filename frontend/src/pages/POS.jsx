import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { formatCurrency } from '../components/Common.jsx';
import { Modal } from '../components/Common.jsx';

const POS = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [marginPresets, setMarginPresets] = useState([20, 25, 30]);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [discount, setDiscount] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [productsRes, categoriesRes, customersRes, settingsRes] = await Promise.all([
        api.get('/products'),
        api.get('/categories'),
        api.get('/customers'),
        api.get('/settings'),
      ]);

      setProducts(productsRes.data.data);
      setCategories(categoriesRes.data.data);
      setCustomers(customersRes.data.data);

      const settings = settingsRes.data.data;
      if (settings.MarginPresets) {
        setMarginPresets(settings.MarginPresets.split(',').map(Number).filter(Boolean));
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    let filtered = products;
    if (activeCategory) {
      filtered = filtered.filter(p => p.category_id === activeCategory);
    }
    if (search) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.id.toLowerCase().includes(search.toLowerCase())
      );
    }
    return filtered;
  }, [products, activeCategory, search]);

  const addToCart = (product) => {
    if (product.displayStock <= 0) {
      toast.error(`${product.name} is out of stock`);
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      
      if (existing) {
        if (existing.qty >= product.displayStock) {
          toast.error('Insufficient stock');
          return prev;
        }
        return prev.map(item =>
          item.productId === product.id
            ? { ...item, qty: item.qty + 1 }
            : item
        );
      }

      const price = product.sell_by_pill
        ? product.selling_price / (product.pills_per_unit || 1)
        : product.selling_price;

      const purchasePrice = product.sell_by_pill
        ? product.purchase_price / (product.pills_per_unit || 1)
        : product.purchase_price;

      const newItem = {
        productId: product.id,
        name: product.name,
        price,
        qty: 1,
        marginUsed: product.default_margin || 25,
        purchasePrice,
        pillsPerUnit: product.pills_per_unit || 1,
        sellByPill: product.sell_by_pill,
        taxRate: product.tax_rate || 0,
        stock: product.displayStock,
      };

      return [...prev, newItem];
    });
  };

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const changeQty = (productId, delta) => {
    setCart(prev => prev.map(item => {
      if (item.productId !== productId) return item;
      const newQty = item.qty + delta;
      if (newQty <= 0) return item;
      if (newQty > item.stock) {
        toast.error(`Only ${item.stock} available`);
        return item;
      }
      return { ...item, qty: newQty };
    }));
  };

  const updateSellByPillQty = (productId, units, pills) => {
    setCart(prev => prev.map(item => {
      if (item.productId !== productId) return item;
      const ppu = item.pillsPerUnit;
      let totalPills = units * ppu + pills;
      if (totalPills <= 0) {
        return item;
      }
      if (totalPills > item.stock) {
        toast.error(`Only ${item.stock} pills available`);
        return item;
      }
      return { ...item, qty: totalPills };
    }));
  };

  const changeMargin = (productId, margin) => {
    setCart(prev => prev.map(item => {
      if (item.productId !== productId) return item;
      const newPrice = item.purchasePrice * (1 + margin / 100);
      return { ...item, price: newPrice, marginUsed: margin };
    }));
  };

  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const discountAmount = subtotal > 0 ? Math.min(parseFloat(discount) || 0, subtotal) : 0;
    const tax = cart.reduce((sum, item) => sum + (item.price * item.qty * item.taxRate) / 100, 0);
    const grandTotal = subtotal - discountAmount + tax;
    return { subtotal, discountAmount, tax, grandTotal };
  }, [cart, discount]);

  const handleCheckout = async () => {
    setProcessing(true);
    try {
      const payload = {
        cart: cart.map(item => ({
          productId: item.productId,
          qty: item.qty,
          unitPrice: Math.round(item.price * 100) / 100,
          marginUsed: item.marginUsed,
        })),
        customerId: selectedCustomer || null,
        paymentMethod,
        discount: totals.discountAmount,
        notes: '',
      };

      const response = await api.post('/sales', payload);
      const { saleId, grandTotal } = response.data.data;

      const receiptData = {
        saleId,
        date: new Date().toISOString(),
        items: cart,
        subtotal: totals.subtotal,
        discount: totals.discountAmount,
        tax: totals.tax,
        grandTotal,
        paymentMethod,
      };

      setReceipt(receiptData);
      setCheckoutModal(false);
      setCart([]);
      setDiscount(0);
      setSelectedCustomer('');
      toast.success('Sale completed!');
      
      // Refresh products to update stock
      const productsRes = await api.get('/products');
      setProducts(productsRes.data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const printReceipt = () => {
    window.print();
  };

  const closeReceipt = () => {
    setReceipt(null);
  };

  return (
    <section className="view active" id="view-pos">
      <div className="view-header">
        <div>
          <h2>Sales (POS)</h2>
          <p>Tap a product to add it to the cart</p>
        </div>
      </div>

      <div className="pos-layout">
        <div>
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              value={activeCategory}
              onChange={(e) => setActiveCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div className="product-grid" id="pos-product-grid">
            {filteredProducts.map(product => (
              <button
                key={product.id}
                className="product-tile"
                disabled={product.displayStock <= 0}
                onClick={() => addToCart(product)}
              >
                <div className="p-name">{product.name}</div>
                <div className="p-meta">
                  {product.sell_by_pill
                    ? `${product.displayStock} pills in stock`
                    : `${product.displayStock} in stock`}
                </div>
                <div className="p-price">
                  {formatCurrency(product.sell_by_pill
                    ? product.selling_price / (product.pills_per_unit || 1)
                    : product.selling_price)}
                  {product.sell_by_pill && <small style={{ fontSize: '10px', color: 'var(--ink-soft)' }}> /pill</small>}
                </div>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>No products found</div>
            )}
          </div>
        </div>

        {/* Cart panel */}
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>Cart</h3>
            {cart.length > 0 && (
              <button className="btn small secondary" onClick={() => setCart([])}>Clear</button>
            )}
          </div>

          <div id="pos-cart">
            {cart.length === 0 ? (
              <div className="empty-state">Cart is empty</div>
            ) : (
              cart.map(item => (
                <div key={item.productId} className="cart-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>{item.name}</strong>
                    <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }} onClick={() => removeFromCart(item.productId)}>✕</button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {item.sellByPill ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                        <input
                          type="number"
                          style={{ width: '36px', padding: '4px' }}
                          min="0"
                          value={Math.floor(item.qty / item.pillsPerUnit)}
                          onChange={(e) => updateSellByPillQty(item.productId, parseInt(e.target.value) || 0, item.qty % item.pillsPerUnit)}
                        /><span>U</span>
                        <input
                          type="number"
                          style={{ width: '36px', padding: '4px' }}
                          min="0"
                          max={item.pillsPerUnit - 1}
                          value={item.qty % item.pillsPerUnit}
                          onChange={(e) => updateSellByPillQty(item.productId, Math.floor(item.qty / item.pillsPerUnit), parseInt(e.target.value) || 0)}
                        /><span>P</span>
                      </div>
                    ) : (
                      <div className="qty-controls">
                        <button onClick={() => changeQty(item.productId, -1)}>-</button>
                        <span>{item.qty}</span>
                        <button onClick={() => changeQty(item.productId, 1)}>+</button>
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <select
                        style={{ padding: '2px 4px', fontSize: '11px' }}
                        value={item.marginUsed}
                        onChange={(e) => changeMargin(item.productId, parseFloat(e.target.value))}
                      >
                        {marginPresets.map(margin => (
                          <option key={margin} value={margin}>{margin}%</option>
                        ))}
                      </select>
                      <strong>{formatCurrency(item.price * item.qty)}</strong>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div id="pos-totals" style={{ marginTop: '16px' }}>
            <div className="cart-total-row">
              <span>Subtotal</span>
              <span>{formatCurrency(totals.subtotal)}</span>
            </div>
            <div className="cart-total-row">
              <span>Tax</span>
              <span>{formatCurrency(totals.tax)}</span>
            </div>
            <div className="cart-total-row grand">
              <span>Total</span>
              <span>{formatCurrency(totals.grandTotal)}</span>
            </div>
          </div>

          <div className="field" style={{ marginTop: '14px' }}>
            <label>Customer (optional)</label>
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
            >
              <option value="">Walk-in</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Payment method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="MobileMoney">Mobile Money</option>
            </select>
          </div>
          <div className="field">
            <label>Discount</label>
            <input
              type="text"
              placeholder="0.00"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          
          <button
            className="btn"
            id="pos-checkout-btn"
            disabled={cart.length === 0 || processing}
            onClick={() => setCheckoutModal(true)}
            style={{ marginTop: '8px' }}
          >
            Charge {formatCurrency(totals.grandTotal)}
          </button>
        </div>
      </div>

      {/* Checkout confirmation modal */}
      {checkoutModal && (
        <Modal
          title="Confirm Checkout"
          onClose={() => setCheckoutModal(false)}
          footer={
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setCheckoutModal(false)}>Cancel</button>
              <button className="btn" onClick={handleCheckout} disabled={processing}>
                {processing ? 'Processing...' : 'Confirm Sale'}
              </button>
            </div>
          }
        >
          <div>
            <div className="cart-total-row"><span>Items</span><span>{cart.length}</span></div>
            <div className="cart-total-row"><span>Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
            <div className="cart-total-row"><span>Discount</span><span>-{formatCurrency(totals.discountAmount)}</span></div>
            <div className="cart-total-row"><span>Tax</span><span>{formatCurrency(totals.tax)}</span></div>
            <div className="cart-total-row grand"><span>Total</span><span>{formatCurrency(totals.grandTotal)}</span></div>
            <div className="cart-total-row"><span>Payment</span><span>{paymentMethod}</span></div>
          </div>
        </Modal>
      )}

      {/* Receipt modal */}
      {receipt && (
        <Modal title="Sale Complete" onClose={closeReceipt}>
          <div style={{ fontFamily: 'monospace', fontSize: '13px', marginBottom: '14px' }}>
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <h3>Pharmacy ERP</h3>
              <p style={{ margin: 0 }}>Receipt #{receipt.saleId}</p>
              <p style={{ margin: 0 }}>{new Date(receipt.date).toLocaleString()}</p>
            </div>
            <hr style={{ borderTop: '1px dashed #ccc' }} />
            {receipt.items.map((item) => (
              <div key={item.productId} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>{item.name}</span>
                <span>{item.qty} × {formatCurrency(item.price)}</span>
                <span>{formatCurrency(item.price * item.qty)}</span>
              </div>
            ))}
            <hr style={{ borderTop: '1px dashed #ccc' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span><span>{formatCurrency(receipt.subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Discount</span><span>-{formatCurrency(receipt.discount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Tax</span><span>{formatCurrency(receipt.tax)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px', marginTop: '6px' }}>
              <span>Total</span><span>{formatCurrency(receipt.grandTotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
              <span>Payment</span><span>{receipt.paymentMethod}</span>
            </div>
            <hr style={{ borderTop: '1px dashed #ccc' }} />
            <p style={{ textAlign: 'center' }}>Thank you for your business!</p>
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={closeReceipt}>Close</button>
            <button className="btn" onClick={printReceipt}>Print Receipt</button>
          </div>
        </Modal>
      )}
    </section>
  );
};

export default POS;