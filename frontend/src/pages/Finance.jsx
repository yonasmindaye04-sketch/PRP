import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { Modal, Loading, Tabs, formatCurrency, formatDate, Pagination } from '../components/Common.jsx';

const emptyExpenseForm = { category: '', amount: '', description: '', expenseDate: new Date().toISOString().split('T')[0] };
const emptyIncomeForm = { category: '', amount: '', description: '', incomeDate: new Date().toISOString().split('T')[0] };
const emptyPaymentForm = { supplierId: '', amount: '', paymentMethod: 'Cash', paymentDate: new Date().toISOString().split('T')[0], notes: '' };

const Finance = () => {
  const [activeTab, setActiveTab] = useState('expenses');
  const [expenses, setExpenses] = useState([]);
  const [income, setIncome] = useState([]);
  const [payments, setPayments] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expensePage, setExpensePage] = useState(1);
  const [incomePage, setIncomePage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('expense');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyExpenseForm);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [expensesRes, incomeRes, paymentsRes, suppliersRes] = await Promise.all([
        api.get('/expenses', { params: { page: expensePage, limit: 20 } }),
        api.get('/income', { params: { page: incomePage, limit: 20 } }),
        api.get('/payments', { params: { page: paymentPage, limit: 20 } }),
        api.get('/suppliers'),
      ]);
      setExpenses(expensesRes.data.data);
      setIncome(incomeRes.data.data);
      setPayments(paymentsRes.data.data);
      setSuppliers(suppliersRes.data.data);
      setPagination({
        expenses: expensesRes.data.pagination,
        income: incomeRes.data.pagination,
        payments: paymentsRes.data.pagination,
      });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [expensePage, incomePage, paymentPage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openExpenseModal = () => {
    setModalType('expense');
    setEditing(null);
    setForm(emptyExpenseForm);
    setShowModal(true);
  };

  const openIncomeModal = () => {
    setModalType('income');
    setEditing(null);
    setForm(emptyIncomeForm);
    setShowModal(true);
  };

  const openPaymentModal = () => {
    setModalType('payment');
    setEditing(null);
    setForm(emptyPaymentForm);
    setShowModal(true);
  };

  const openEditExpense = (expense) => {
    setModalType('expense');
    setEditing(expense);
    setForm({
      category: expense.category,
      amount: expense.amount,
      description: expense.description || '',
      expenseDate: new Date(expense.expense_date).toISOString().split('T')[0],
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modalType === 'expense') {
        if (editing) {
          await api.put(`/expenses/${editing.id}`, form);
          toast.success('Expense updated');
        } else {
          await api.post('/expenses', form);
          toast.success('Expense recorded');
        }
      } else if (modalType === 'income') {
        if (editing) {
          await api.put(`/income/${editing.id}`, form);
          toast.success('Income updated');
        } else {
          await api.post('/income', form);
          toast.success('Income recorded');
        }
      } else {
        await api.post('/payments', form);
        toast.success('Payment recorded');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (type, item) => {
    if (!window.confirm(`Delete this ${type} record?`)) return;
    try {
      if (type === 'expense') {
        await api.delete(`/expenses/${item.id}`);
      } else if (type === 'income') {
        await api.delete(`/income/${item.id}`);
      } else {
        await api.delete(`/payments/${item.id}`);
      }
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} record deleted`);
      loadData();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const tabs = [
    { key: 'expenses', label: 'Expenses' },
    { key: 'income', label: 'Income' },
    { key: 'payments', label: 'Supplier Payments' },
  ];

  return (
    <section className="view active" id="view-finance">
      <div className="view-header">
        <div>
          <h2>Finance</h2>
          <p>Manage expenses, income, and supplier payments</p>
        </div>
        <button
          className="btn"
          onClick={activeTab === 'expenses' ? openExpenseModal : activeTab === 'income' ? openIncomeModal : openPaymentModal}
        >
          Add {activeTab === 'payments' ? 'Payment' : activeTab === 'income' ? 'Income' : 'Expense'}
        </button>
      </div>

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {loading ? <Loading /> : (
        <div style={{ marginTop: '16px' }}>
          {activeTab === 'expenses' && (
            <>
              <div className="panel" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Recorded By</th>
                      <th>Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map(expense => (
                      <tr key={expense.id}>
                        <td>{formatDate(expense.expense_date)}</td>
                        <td><strong>{expense.category}</strong></td>
                        <td>{expense.description || '-'}</td>
                        <td>{expense.recorded_by_name || '-'}</td>
                        <td><strong style={{ color: 'var(--danger)' }}>{formatCurrency(expense.amount)}</strong></td>
                        <td className="row-actions">
                          <button onClick={() => openEditExpense(expense)}>Edit</button>
                          <button onClick={() => handleDelete('expense', expense)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                    {expenses.length === 0 && (
                      <tr><td colSpan="6" className="empty-state">No expenses recorded</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={expensePage} totalPages={pagination.expenses?.totalPages || 1} onChange={setExpensePage} />
            </>
          )}

          {activeTab === 'income' && (
            <>
              <div className="panel" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Recorded By</th>
                      <th>Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {income.map(item => (
                      <tr key={item.id}>
                        <td>{formatDate(item.income_date)}</td>
                        <td><strong>{item.category}</strong></td>
                        <td>{item.description || '-'}</td>
                        <td>{item.recorded_by_name || '-'}</td>
                        <td><strong style={{ color: 'var(--primary-dark)' }}>{formatCurrency(item.amount)}</strong></td>
                        <td className="row-actions">
                          <button onClick={() => handleDelete('income', item)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                    {income.length === 0 && (
                      <tr><td colSpan="6" className="empty-state">No income recorded</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={incomePage} totalPages={pagination.income?.totalPages || 1} onChange={setIncomePage} />
            </>
          )}

          {activeTab === 'payments' && (
            <>
              <div className="panel" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Supplier</th>
                      <th>Method</th>
                      <th>Recorded By</th>
                      <th>Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(payment => (
                      <tr key={payment.id}>
                        <td>{formatDate(payment.payment_date)}</td>
                        <td><strong>{payment.supplier_name}</strong></td>
                        <td>{payment.payment_method}</td>
                        <td>{payment.recorded_by_name || '-'}</td>
                        <td><strong>{formatCurrency(payment.amount)}</strong></td>
                        <td className="row-actions">
                          <button onClick={() => handleDelete('payment', payment)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                    {payments.length === 0 && (
                      <tr><td colSpan="6" className="empty-state">No supplier payments recorded</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={paymentPage} totalPages={pagination.payments?.totalPages || 1} onChange={setPaymentPage} />
            </>
          )}
        </div>
      )}

      {showModal && (
        <Modal
          title={
            modalType === 'expense' ? (editing ? 'Edit Expense' : 'Record Expense') :
            modalType === 'income' ? 'Record Income' : 'Record Supplier Payment'
          }
          onClose={() => setShowModal(false)}
        >
          <form onSubmit={handleSubmit}>
            {modalType === 'payment' && (
              <div className="field">
                <label>Supplier *</label>
                <select
                  value={form.supplierId}
                  onChange={(e) => setField('supplierId', e.target.value)}
                  required
                >
                  <option value="">Select supplier</option>
                  {suppliers.map(sup => (
                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="field-grid">
              <div className="field">
                <label>{modalType === 'payment' ? 'Payment Method' : 'Category'} *</label>
                {modalType === 'payment' ? (
                  <select
                    value={form.paymentMethod}
                    onChange={(e) => setField('paymentMethod', e.target.value)}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="MobileMoney">Mobile Money</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setField('category', e.target.value)}
                    placeholder={modalType === 'expense' ? 'e.g. Rent, Utilities' : 'e.g. Consultation'}
                    required
                  />
                )}
              </div>
              <div className="field">
                <label>Amount ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setField('amount', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  value={form.expenseDate || form.incomeDate || form.paymentDate}
                  onChange={(e) => {
                    if (modalType === 'expense') setField('expenseDate', e.target.value);
                    else if (modalType === 'income') setField('incomeDate', e.target.value);
                    else setField('paymentDate', e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label>{modalType === 'payment' ? 'Notes' : 'Description'}</label>
                <input
                  type="text"
                  value={form.description || form.notes || ''}
                  onChange={(e) => {
                    if (modalType === 'payment') setField('notes', e.target.value);
                    else setField('description', e.target.value);
                  }}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
};

export default Finance;