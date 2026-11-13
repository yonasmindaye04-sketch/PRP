import { useState, useEffect } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import toast from 'react-hot-toast';
import { Loading } from '../components/Common.jsx';

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});
  const [businessInfo, setBusinessInfo] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [settingsRes, businessRes] = await Promise.all([
        api.get('/settings'),
        api.get('/business-info'),
      ]);
      setSettings(settingsRes.data.data || {});
      setBusinessInfo(businessRes.data.data || {});
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await api.put('/settings', settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveBusinessInfo = async () => {
    setSaving(true);
    try {
      await api.put('/business-info', businessInfo);
      toast.success('Business info saved');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading text="Loading settings..." />;

  return (
    <section className="view active" id="view-settings">
      <div className="view-header">
        <div>
          <h2>Settings</h2>
          <p>Configure business information and system settings</p>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Business Information</h3>
        <div className="field-grid">
          <div className="field">
            <label>Business Name</label>
            <input
              type="text"
              value={businessInfo.name || ''}
              onChange={(e) => setBusinessInfo(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Phone</label>
            <input
              type="text"
              value={businessInfo.phone || ''}
              onChange={(e) => setBusinessInfo(prev => ({ ...prev, phone: e.target.value }))}
            />
          </div>
        </div>
        <div className="field-grid">
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={businessInfo.email || ''}
              onChange={(e) => setBusinessInfo(prev => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Tax Number</label>
            <input
              type="text"
              value={businessInfo.tax_number || ''}
              onChange={(e) => setBusinessInfo(prev => ({ ...prev, tax_number: e.target.value }))}
            />
          </div>
        </div>
        <div className="field">
          <label>Address</label>
          <textarea
            rows="2"
            value={businessInfo.address || ''}
            onChange={(e) => setBusinessInfo(prev => ({ ...prev, address: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Receipt Footer Text</label>
          <input
            type="text"
            value={businessInfo.receipt_footer || ''}
            onChange={(e) => setBusinessInfo(prev => ({ ...prev, receipt_footer: e.target.value }))}
            placeholder="Thank you for your business!"
          />
        </div>
        <div style={{ marginTop: '16px' }}>
          <button className="btn" onClick={saveBusinessInfo} disabled={saving}>
            {saving ? 'Saving...' : 'Save Business Info'}
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: '16px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>System Settings</h3>
        <div className="field-grid">
          <div className="field">
            <label>Low Stock Alert Threshold</label>
            <input
              type="number"
              min="0"
              value={settings.LowStockAlertThreshold || ''}
              onChange={(e) => setSettings(prev => ({ ...prev, LowStockAlertThreshold: e.target.value }))}
            />
            <small style={{ color: 'var(--ink-soft)' }}>Fallback threshold for products without a reorder level</small>
          </div>
          <div className="field">
            <label>Margin Presets (CSV)</label>
            <input
              type="text"
              value={settings.MarginPresets || ''}
              onChange={(e) => setSettings(prev => ({ ...prev, MarginPresets: e.target.value }))}
              placeholder="20,25,30,35,40"
            />
            <small style={{ color: 'var(--ink-soft)' }}>Comma-separated margins shown in the POS</small>
          </div>
        </div>
        <div className="field-grid">
          <div className="field">
            <label>Default Tax Rate (%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={settings.TaxRate || '0'}
              onChange={(e) => setSettings(prev => ({ ...prev, TaxRate: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Currency</label>
            <input
              type="text"
              value={settings.Currency || ''}
              onChange={(e) => setSettings(prev => ({ ...prev, Currency: e.target.value }))}
              placeholder="USD"
            />
          </div>
        </div>
        <div style={{ marginTop: '16px' }}>
          <button className="btn" onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </section>
  );
};

export default Settings;