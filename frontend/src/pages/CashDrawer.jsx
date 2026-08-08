import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { Modal, Loading, Tabs, formatCurrency, formatDateTime, Pagination } from '../components/Common.jsx';

const CashDrawer = () => {
  const [openShift, setOpenShift] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [countedCash, setCountedCash] = useState('');
  const [endResult, setEndResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('current');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [openRes, historyRes] = await Promise.all([
        api.get('/cashdrawer/open'),
        api.get('/cashdrawer/history', { params: { page: historyPage, limit: 20 } }),
      ]);
      setOpenShift(openRes.data.data);
      setHistory(historyRes.data.data);
      setPagination(historyRes.data.pagination);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [historyPage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const startShift = async () => {
    setProcessing(true);
    try {
      await api.post('/cashdrawer/start', { openingBalance: parseFloat(openingBalance) || 0 });
      toast.success('Shift started');
      setShowStartModal(false);
      setOpeningBalance(0);
      loadData();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const endShift = async () => {
    setProcessing(true);
    try {
      const response = await api.post('/cashdrawer/end', { countedCash: parseFloat(countedCash) });
      setEndResult(response.data.data);
      setShowEndModal(false);
      loadData();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const tabs = [
    { key: 'current', label: 'Current Shift' },
    { key: 'history', label: 'Shift History' },
  ];

  const expectedBalance = openShift
    ? parseFloat(openShift.opening_balance) + parseFloat(openShift.cash_sales) - parseFloat(openShift.expenses)
    : 0;

  return (
    <section className="view active" id="view-cashdrawer">
      <div className="view-header">
        <div>
          <h2>Cash Drawer</h2>
          <p>Manage your shifts and track cash</p>
        </div>
        {openShift ? (
          <button className="btn secondary" onClick={() => setShowEndModal(true)}>
            End Shift
          </button>
        ) : (
          <button className="btn" onClick={() => setShowStartModal(true)}>
            Start Shift
          </button>
        )}
      </div>

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {loading ? <Loading /> : (
        <div style={{ marginTop: '16px' }}>
          {activeTab === 'current' && (
            <>
              {openShift ? (
                <div className="cards">
                  <div className="card">
                    <div className="card-title">Opening Balance</div>
                    <div className="card-value">{formatCurrency(openShift.opening_balance)}</div>
                    <div style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>Started {formatDateTime(openShift.opened_at)}</div>
                  </div>
                  <div className="card">
                    <div className="card-title">Cash Sales</div>
                    <div className="card-value">{formatCurrency(openShift.cash_sales)}</div>
                  </div>
                  <div className="card">
                    <div className="card-title">Card Sales</div>
                    <div className="card-value">{formatCurrency(openShift.card_sales)}</div>
                  </div>
                  <div className="card">
                    <div className="card-title">Mobile Money</div>
                    <div className="card-value">{formatCurrency(openShift.mobile_money_sales)}</div>
                  </div>
                  <div className="card">
                    <div className="card-title">Expenses</div>
                    <div className="card-value">{formatCurrency(openShift.expenses)}</div>
                  </div>
                  <div className="card">
                    <div className="card-title">Expected Balance</div>
                    <div className="card-value">{formatCurrency(expectedBalance)}</div>
                    <div style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>Opening + Cash Sales - Expenses</div>
                  </div>
                </div>
              ) : (
                <div className="panel" style={{ textAlign: 'center', padding: '40px' }}>
                  <h3 style={{ marginBottom: '10px' }}>No Active Shift</h3>
                  <p style={{ color: 'var(--ink-soft)', marginBottom: '20px' }}>Start a shift to begin recording sales</p>
                  <button className="btn" onClick={() => setShowStartModal(true)}>
                    Start Shift
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <>
              <div className="panel" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Cashier</th>
                      <th>Opened</th>
                      <th>Closed</th>
                      <th>Opening</th>
                      <th>Cash Sales</th>
                      <th>Counted</th>
                      <th>Difference</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(shift => (
                      <tr key={shift.id}>
                        <td><strong>{shift.cashier_name}</strong></td>
                        <td>{formatDateTime(shift.opened_at)}</td>
                        <td>{shift.closed_at ? formatDateTime(shift.closed_at) : '-'}</td>
                        <td>{formatCurrency(shift.opening_balance)}</td>
                        <td>{formatCurrency(shift.cash_sales)}</td>
                        <td>{shift.counted_cash !== null ? formatCurrency(shift.counted_cash) : '-'}</td>
                        <td>
                          <strong style={{ color: shift.difference >= 0 ? 'var(--primary-dark)' : 'var(--danger)' }}>
                            {shift.difference !== null ? formatCurrency(shift.difference) : '-'}
                          </strong>
                        </td>
                        <td>
                          <span className={`pill ${shift.status === 'Open' ? 'low' : 'ok'}`}>
                            {shift.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {history.length === 0 && (
                      <tr><td colSpan="8" className="empty-state">No shift history</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={historyPage} totalPages={pagination?.totalPages || 1} onChange={setHistoryPage} />
            </>
          )}
        </div>
      )}

      {/* Start shift modal */}
      {showStartModal && (
        <Modal title="Start Shift" onClose={() => setShowStartModal(false)}>
          <div className="field">
            <label>Opening Balance ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setShowStartModal(false)}>Cancel</button>
            <button className="btn" onClick={startShift} disabled={processing}>
              {processing ? 'Starting...' : 'Start Shift'}
            </button>
          </div>
        </Modal>
      )}

      {/* End shift modal */}
      {showEndModal && (
        <Modal title="End Shift" onClose={() => setShowEndModal(false)}>
          <div style={{ marginBottom: '16px' }}>
            <div className="cart-total-row"><span>Expected Balance</span><span>{formatCurrency(expectedBalance)}</span></div>
          </div>
          <div className="field">
            <label>Counted Cash ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setShowEndModal(false)}>Cancel</button>
            <button className="btn" onClick={endShift} disabled={processing}>
              {processing ? 'Ending...' : 'End Shift'}
            </button>
          </div>
        </Modal>
      )}

      {/* End result modal */}
      {endResult && (
        <Modal title="Shift Closed" onClose={() => setEndResult(null)}>
          <div className="cards" style={{ gridTemplateColumns: '1fr', marginBottom: '0', gap: '8px' }}>
            <div className="card" style={{ padding: '12px' }}>
              <div className="card-title">Expected</div>
              <div className="card-value">{formatCurrency(endResult.expected)}</div>
            </div>
            <div className="card" style={{ padding: '12px' }}>
              <div className="card-title">Counted</div>
              <div className="card-value">{formatCurrency(endResult.countedCash)}</div>
            </div>
            <div className="card" style={{ padding: '12px' }}>
              <div className="card-title">Difference</div>
              <div className="card-value" style={{ color: endResult.difference >= 0 ? 'var(--primary-dark)' : 'var(--danger)' }}>
                {formatCurrency(endResult.difference)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px' }}>
                {endResult.difference === 0 ? 'Perfect! No discrepancy' : endResult.difference > 0 ? 'Over' : 'Short'}
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setEndResult(null)}>OK</button>
          </div>
        </Modal>
      )}
    </section>
  );
};

export default CashDrawer;