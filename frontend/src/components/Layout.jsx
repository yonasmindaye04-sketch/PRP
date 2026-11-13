import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NavItem = ({ label, to, onClick, active }) => (
  <button
    onClick={() => { onClick(to); }}
    className={`nav-item ${active ? 'active' : ''}`}
    title={label}
  >
    <span className="dot"></span>
    <span className="label">{label}</span>
  </button>
);

const Layout = () => {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const navItems = [
    { label: 'Dashboard', to: '/', perm: 'PERM_VIEW_DASHBOARD' },
    { label: 'Sales (POS)', to: '/pos', perm: 'PERM_SELL' },
    { label: 'Sales History', to: '/sales', perm: 'PERM_VIEW_SALES' },
    { section: 'Inventory' },
    { label: 'Products', to: '/products', perm: 'PERM_VIEW_PRODUCTS' },
    { label: 'Purchases', to: '/purchases', perm: 'PERM_MANAGE_PURCHASES' },
    { label: 'Suppliers', to: '/suppliers', perm: 'PERM_MANAGE_SUPPLIERS' },
    { section: 'Business' },
    { label: 'Customers', to: '/customers', perm: 'PERM_MANAGE_CUSTOMERS' },
    { label: 'Finance', to: '/finance', perm: 'PERM_MANAGE_EXPENSES' },
    { label: 'Cash Drawer', to: '/cashdrawer', perm: 'PERM_MANAGE_CASHDRAWER' },
    { section: 'Admin' },
    { label: 'Users', to: '/users', perm: 'PERM_MANAGE_USERS' },
    { label: 'Settings', to: '/settings', perm: 'PERM_MANAGE_SETTINGS' },
  ];

  const currentPath = location.pathname;

  const handleNav = (to) => {
    navigate(to);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div id="app-shell" className="active">
      <div className="topbar">
        <button className="hamburger" onClick={() => setMobileOpen(!mobileOpen)}>☰</button>
        <div className="brand-mark">Rx</div>
        <div className="topbar-title">Pharmacy ERP</div>
      </div>
      
      <div className={`sidebar-backdrop ${mobileOpen ? 'active' : ''}`} onClick={() => setMobileOpen(false)}></div>
      
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">Rx</div>
          <div className="brand-name">Pharmacy ERP</div>
        </div>

        {navItems.map((item, index) => {
          if (item.section) {
            // Check if there are any visible items in this section
            const sectionIndex = navItems.indexOf(item);
            let nextSectionIndex = navItems.findIndex((it, idx) => idx > sectionIndex && it.section);
            if (nextSectionIndex === -1) nextSectionIndex = navItems.length;
            
            const sectionItems = navItems.slice(sectionIndex + 1, nextSectionIndex);
            const hasVisibleItems = sectionItems.some(it => hasPermission(it.perm));
            
            if (!hasVisibleItems) return null;
            return <div key={index} className="nav-section">{item.section}</div>;
          }
          
          if (!hasPermission(item.perm)) return null;
          
          return (
            <NavItem
              key={item.to}
              label={item.label}
              to={item.to}
              active={currentPath === item.to}
              onClick={handleNav}
            />
          );
        })}

        <div className="sidebar-footer">
          <div className="dev-info" style={{fontSize: '10.5px', color: '#8fc3b5', marginBottom: '8px', lineHeight: '1.5'}}>
            Developed by <b style={{color: '#fff'}}>Yonas Mindaye</b><br/>
            <a href="https://github.com/yona64" target="_blank" rel="noreferrer" style={{color: '#7fe0c4', textDecoration: 'none'}}>@yona64</a> | 
            <a href="tel:+251910011818" style={{color: '#7fe0c4', textDecoration: 'none'}}>0910011818</a><br/>
            <a href="mailto:yonasmindaye04@gmail.com" style={{color: '#7fe0c4', textDecoration: 'none'}}>yonasmindaye04@gmail.com</a> | 
            <a href="https://afro-tech-et.vercel.app" target="_blank" rel="noreferrer" style={{color: '#7fe0c4', textDecoration: 'none'}}>afro-tech-et.vercel.app</a>
          </div>
          <div className="user-chip">
            <b>{user?.name || '-'}</b>
            <span>{user?.roleName || '-'}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;