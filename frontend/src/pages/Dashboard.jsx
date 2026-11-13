import { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import toast from 'react-hot-toast';
import { Loading, formatCurrency, formatDate } from '../components/Common.jsx';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#00b4d8', '#2dce89', '#ff6b6b', '#ffc107', '#6610f2', '#fd7e14', '#20c997', '#e83e8c'];

const Dashboard = () => {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [salesTrend, setSalesTrend] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState([]);
  const [profitTrend, setProfitTrend] = useState([]);
  const [periodComparison, setPeriodComparison] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [expiring, setExpiring] = useState([]);

  const canViewProfit = hasPermission('PERM_VIEW_PROFIT');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, trendRes, topRes, catRes, periodRes, lowStockRes, expiringRes] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/dashboard/sales-trend?days=14'),
        api.get('/dashboard/top-products?days=30&limit=5'),
        api.get('/dashboard/category-breakdown?days=30'),
        api.get('/dashboard/period-comparison'),
        api.get('/dashboard/low-stock'),
        api.get('/dashboard/expiring?days=90'),
      ]);

      setSummary(summaryRes.data.data);
      setSalesTrend(trendRes.data.data);
      setTopProducts(topRes.data.data);
      setCategoryBreakdown(catRes.data.data);
      setPeriodComparison(periodRes.data.data);
      setLowStock(lowStockRes.data.data);
      setExpiring(expiringRes.data.data);

      if (canViewProfit) {
        const profitRes = await api.get('/dashboard/profit-trend?days=14');
        setProfitTrend(profitRes.data.data);
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canViewProfit]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) return <Loading text="Loading dashboard..." />;

  return (
    <section className="view active" id="view-dashboard">
      <div className="view-header">
        <div>
          <h2>Dashboard</h2>
          <p>Overview of your pharmacy operations</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="cards">
        <div className="card">
          <div className="label">Today's Sales</div>
          <div className="value">{formatCurrency(summary?.today?.sales)}</div>
          <div style={{fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px'}}>{summary?.today?.transactionCount} transactions</div>
        </div>
        <div className="card">
          <div className="label">Today's Expenses</div>
          <div className="value">{formatCurrency(summary?.today?.expenses)}</div>
          <div style={{fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px'}}>Operating costs</div>
        </div>
        {canViewProfit && (
          <div className="card">
            <div className="label">Today's Profit</div>
            <div className="value" style={{ color: summary?.today?.profit >= 0 ? 'var(--primary-dark)' : 'var(--danger)' }}>
              {formatCurrency(summary?.today?.profit)}
            </div>
            <div style={{fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px'}}>Revenue - COGS</div>
          </div>
        )}
        <div className="card">
          <div className="label">Products</div>
          <div className="value">{summary?.inventory?.productCount}</div>
          <div style={{fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px'}}>{summary?.inventory?.lowStock} low stock · {summary?.inventory?.expirySoon} expiring soon</div>
        </div>
      </div>

      {/* Period Comparison */}
      {periodComparison && (
        <div className="cards">
          <div className="card">
            <div className="label">This Month</div>
            <div className="value">{formatCurrency(periodComparison.thisMonth)}</div>
            <div style={{fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px'}}>
              {periodComparison.monthChange >= 0 ? '+' : ''}{periodComparison.monthChange}% vs last month
            </div>
          </div>
          <div className="card">
            <div className="label">This Year</div>
            <div className="value">{formatCurrency(periodComparison.thisYear)}</div>
            <div style={{fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px'}}>
              {periodComparison.yearChange >= 0 ? '+' : ''}{periodComparison.yearChange}% vs last year
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="charts-grid">
        <div className="panel">
          <h3>Sales Trend (Last 14 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={salesTrend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value) => formatCurrency(value)}
                labelFormatter={(label) => formatDate(label)}
              />
              <Legend />
              <Line type="monotone" dataKey="totalSales" name="Sales" stroke="var(--primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>Top Products (Last 30 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topProducts} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
              <Tooltip formatter={(value) => formatCurrency(value)} />
              <Bar dataKey="total_revenue" name="Revenue" fill="var(--primary-dark)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="charts-grid">
        {canViewProfit && (
          <div className="panel">
            <h3>Profit Trend (Last 14 Days)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={profitTrend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" name="Profit" fill="#2dce89" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="panel">
          <h3>Category Breakdown (Last 30 Days)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={categoryBreakdown}
                dataKey="total_revenue"
                nameKey="category_name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={(entry) => entry.category_name}
              >
                {categoryBreakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(value)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Low Stock & Expiring */}
      <div className="charts-grid">
        <div className="panel" style={{padding: 0}}>
          <h3 style={{padding: '16px 16px 0'}}>Low Stock Alerts</h3>
          {lowStock.length === 0 ? (
            <div className="empty-state">All products are well stocked</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Stock</th>
                  <th>Reorder Level</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.category_name}</td>
                    <td>{p.current_stock}</td>
                    <td>{p.reorder_level}</td>
                    <td><span className="pill bad">Low Stock</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel" style={{padding: 0}}>
          <h3 style={{padding: '16px 16px 0'}}>Expiring Soon (90 Days)</h3>
          {expiring.length === 0 ? (
            <div className="empty-state">No products expiring soon</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch</th>
                  <th>Expiry Date</th>
                  <th>Quantity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((p) => (
                  <tr key={p.batch_id}>
                    <td>{p.product_name}</td>
                    <td>{p.batch_id}</td>
                    <td>{formatDate(p.expiry_date)}</td>
                    <td>{p.batch_quantity}</td>
                    <td><span className="pill low">Expiring</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
};

export default Dashboard;