import { useAuth } from '../context/AuthContext.jsx';

export const Modal = ({ title, onClose, children, footer }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-actions">{footer}</div>}
    </div>
  </div>
);

export const Loading = ({ text = 'Loading...' }) => (
  <div className="loading-container">
    <div className="spinner" />
    <p>{text}</p>
  </div>
);

export const EmptyState = ({ message = 'No data available' }) => (
  <div className="empty-state">
    <p>{message}</p>
  </div>
);

export const Badge = ({ type = 'secondary', children }) => {
  const pillType = type === 'danger' ? 'bad' : type === 'success' ? 'ok' : type === 'warning' ? 'low' : type === 'info' ? '' : '';
  return <span className={`pill ${pillType}`.trim()}>{children}</span>;
};

export const formatCurrency = (value) => {
  const num = parseFloat(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
};

export const formatDate = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatDateTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const Can = ({ permission, children }) => {
  const { hasPermission } = useAuth();
  return hasPermission(permission) ? children : null;
};

export const Tabs = ({ tabs, active, onChange }) => (
  <div className="tabs">
    {tabs.map((tab) => (
      <button
        key={tab.key}
        className={`tab ${active === tab.key ? 'active' : ''}`}
        onClick={() => onChange(tab.key)}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

export const Pagination = ({ page, totalPages, onChange }) => {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px', alignItems: 'center' }}>
      <button
        className="btn secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span style={{ fontSize: '14px', color: 'var(--ink-soft)' }}>
        Page {page} of {totalPages}
      </span>
      <button
        className="btn secondary"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
};