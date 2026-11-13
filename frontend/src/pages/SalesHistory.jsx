import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { Modal, Loading, formatCurrency, formatDateTime, Pagination } from '../components/Common.jsx';

const SalesHistory = () => {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [selectedSale, setSelectedSale] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [returnModal, setReturnModal] = useState(null);
  const [returnForm, setReturnForm] = useState({ quantity: 1, reason: 'CustomerReturn' });
  const [processingReturn, setProcessingReturn] = useState(false);

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = `${endDate}T23:59:59`;
      if (paymentMethod) params.paymentMethod = paymentMethod;

      const response = await api.get('/sales', { params });
      setSales(response.data.data);
      setPagination(response.data.pagination);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, startDate, endDate, paymentMethod]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const viewSale = async (sale) => {
    setDetailLoading(true);
    setSelectedSale(sale);
    try {
      const response = await api.get(`/sales/${sale.id}`);
      setSelectedSale(response.data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const openReturn = (saleId, item) => {
    setReturnForm({
      saleId,
      productId: item.product_id,
      quantity: item.quantity,
      maxQuantity: item.quantity,
      reason: 'CustomerReturn',
    });
    setReturnModal(true);
  };

  const handleReturn = async (e) => {
    e.preventDefault();
    setProcessingReturn(true);
    try {
      await api.post('/returns', {
        saleId: returnForm.saleId,
        productId: returnForm.productId,
        quantity: parseInt(returnForm.quantity),
        reason: returnForm.reason,
      });
      toast.success('Return processed successfully');
      setReturnModal(false);
      viewSale({ id: returnForm.saleId });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setProcessingReturn(false);
    }
  };

  return (
    <section className="view active" id="view-salesHistory">
      <div className="view-header">
        <div>
          <h2>Sales History</h2>
          <p>Recent transactions — click a row to view/return items</p>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="date"
          value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
        />
        <select
          value={paymentMethod}
          onChange={(e) => { setPaymentMethod(e.target.value); setPage(1); }}
        >
          <option value="">All payment methods</option>
          <option value="Cash">Cash</option>
          <option value="Card">Card</option>
          <option value="MobileMoney">Mobile Money</option>
        </select>
        <button className="btn small secondary" onClick={() => { setStartDate(''); setEndDate(''); setPaymentMethod(''); setPage(1); }}>
          Clear
        </button>
      </div>

      {loading ? <Loading /> : (
        <>
          <div className="panel" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Sale ID</th>
                  <th>Date</th>
                  <th>Cashier</th>
                  <th>Customer</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sales.map(sale => (
                  <tr key={sale.id} onClick={() => viewSale(sale)} style={{ cursor: 'pointer' }}>
                    <td>{sale.id}</td>
                    <td>{formatDateTime(sale.created_at)}</td>
                    <td>{sale.cashier_name}</td>
                    <td>{sale.customer_name || 'Walk-in'}</td>
                    <td>
                      <span className={`pill ${sale.payment_method === 'Cash' ? 'ok' : sale.payment_method === 'Card' ? 'low' : 'bad'}`}>
                        {sale.payment_method}
                      </span>
                    </td>
                    <td><strong>{formatCurrency(sale.grand_total)}</strong></td>
                    <td className="row-actions">
                      <button>View</button>
                    </td>
                  </tr>
                ))}
                {sales.length === 0 && (
                  <tr><td colSpan="7" className="empty-state">No sales found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={pagination?.totalPages || 1} onChange={setPage} />
        </>
      )}

      {/* Sale detail modal */}
      {selectedSale && (
        <Modal title={`Sale ${selectedSale.id}`} onClose={() => setSelectedSale(null)}>
          {detailLoading ? <Loading /> : (
            <div>
              <div className="field-grid">
                <div className="field">
                  <label>Date</label>
                  <div>{formatDateTime(selectedSale.created_at)}</div>
                </div>
                <div className="field">
                  <label>Cashier</label>
                  <div>{selectedSale.cashier_name}</div>
                </div>
                <div className="field">
                  <label>Customer</label>
                  <div>{selectedSale.customer_name || 'Walk-in'}</div>
                </div>
                <div className="field">
                  <label>Payment Method</label>
                  <div>{selectedSale.payment_method}</div>
                </div>
              </div>

              <h3 style={{ margin: '14px 0 8px', fontSize: '14.5px' }}>Items</h3>
              <div className="panel" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Price</th>
                      <th>Line Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSale.items?.map((item) => (
                      <tr key={item.id}>
                        <td>{item.product_name}</td>
                        <td>{item.quantity}</td>
                        <td>{formatCurrency(item.unit_price)}</td>
                        <td>{formatCurrency(item.line_total)}</td>
                        <td className="row-actions">
                          <button onClick={() => openReturn(selectedSale.id, item)}>Return</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '16px' }}>
                <div className="cart-total-row"><span>Subtotal</span><span>{formatCurrency(selectedSale.subtotal)}</span></div>
                <div className="cart-total-row"><span>Discount</span><span>-{formatCurrency(selectedSale.discount)}</span></div>
                <div className="cart-total-row"><span>Tax</span><span>{formatCurrency(selectedSale.tax)}</span></div>
                <div className="cart-total-row grand"><span>Total</span><span>{formatCurrency(selectedSale.grand_total)}</span></div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Return modal */}
      {returnModal && (
        <Modal title="Process Return" onClose={() => setReturnModal(false)}>
          <form onSubmit={handleReturn}>
            <div className="field">
              <label>Quantity (max {returnForm.maxQuantity})</label>
              <input
                type="number"
                min="1"
                max={returnForm.maxQuantity}
                value={returnForm.quantity}
                onChange={(e) => setReturnForm(prev => ({ ...prev, quantity: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label>Reason</label>
              <select
                value={returnForm.reason}
                onChange={(e) => setReturnForm(prev => ({ ...prev, reason: e.target.value }))}
              >
                <option value="CustomerReturn">Customer Return</option>
                <option value="Damaged">Damaged</option>
                <option value="Expired">Expired</option>
                <option value="WrongItem">Wrong Item</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setReturnModal(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={processingReturn}>
                {processingReturn ? 'Processing...' : 'Process Return'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
};

export default SalesHistory;