import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, PermissionRoute } from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import POS from './pages/POS.jsx';
import SalesHistory from './pages/SalesHistory.jsx';
import Products from './pages/Products.jsx';
import Purchases from './pages/Purchases.jsx';
import Suppliers from './pages/Suppliers.jsx';
import Customers from './pages/Customers.jsx';
import Finance from './pages/Finance.jsx';
import CashDrawer from './pages/CashDrawer.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';

const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        
        <Route
          path="pos"
          element={
            <PermissionRoute permission="PERM_SELL">
              <POS />
            </PermissionRoute>
          }
        />
        
        <Route
          path="sales"
          element={
            <PermissionRoute permission="PERM_VIEW_SALES">
              <SalesHistory />
            </PermissionRoute>
          }
        />
        
        <Route
          path="products"
          element={
            <PermissionRoute permission="PERM_VIEW_PRODUCTS">
              <Products />
            </PermissionRoute>
          }
        />
        
        <Route
          path="purchases"
          element={
            <PermissionRoute permission="PERM_MANAGE_PURCHASES">
              <Purchases />
            </PermissionRoute>
          }
        />
        
        <Route
          path="suppliers"
          element={
            <PermissionRoute permission="PERM_MANAGE_SUPPLIERS">
              <Suppliers />
            </PermissionRoute>
          }
        />
        
        <Route
          path="customers"
          element={
            <PermissionRoute permission="PERM_MANAGE_CUSTOMERS">
              <Customers />
            </PermissionRoute>
          }
        />
        
        <Route
          path="finance"
          element={
            <PermissionRoute permission="PERM_MANAGE_EXPENSES">
              <Finance />
            </PermissionRoute>
          }
        />
        
        <Route
          path="cashdrawer"
          element={
            <PermissionRoute permission="PERM_MANAGE_CASHDRAWER">
              <CashDrawer />
            </PermissionRoute>
          }
        />
        
        <Route
          path="users"
          element={
            <PermissionRoute permission="PERM_MANAGE_USERS">
              <Users />
            </PermissionRoute>
          }
        />
        
        <Route
          path="settings"
          element={
            <PermissionRoute permission="PERM_MANAGE_SETTINGS">
              <Settings />
            </PermissionRoute>
          }
        />
      </Route>
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;