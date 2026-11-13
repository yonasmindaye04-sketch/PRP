import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { pool, query, getClient } from '../src/config/database.js';

const hashPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

const nextId = async (prefix, table, idField) => {
  const result = await query(
    `SELECT ${idField} FROM ${table} WHERE ${idField} LIKE $1 ORDER BY ${idField} DESC LIMIT 1`,
    [`${prefix}%`]
  );
  
  let nextNum = 1;
  if (result.rows.length > 0) {
    const lastId = result.rows[0][idField];
    const num = parseInt(lastId.replace(prefix, ''));
    if (!isNaN(num)) {
      nextNum = num + 1;
    }
  }
  
  return `${prefix}${String(nextNum).padStart(6, '0')}`;
};

async function seed() {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    console.log('Starting database seeding...');
    
    // Check if already seeded
    const userCheck = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCheck.rows[0].count) > 0) {
      console.log('Database already seeded, skipping...');
      await client.query('COMMIT');
      return;
    }
    
    // 1. Seed Roles
    console.log('Seeding roles...');
    const roles = [
      { id: 'ROLE_OWNER', name: 'Owner', description: 'Full system access' },
      { id: 'ROLE_PHARMACIST', name: 'Pharmacist', description: 'Manage products, purchases, sales, view profit' },
      { id: 'ROLE_CASHIER', name: 'Cashier', description: 'Process sales, manage cash drawer' }
    ];
    
    for (const role of roles) {
      await client.query(
        'INSERT INTO roles (id, name, description) VALUES ($1, $2, $3)',
        [role.id, role.name, role.description]
      );
    }
    
    // 2. Seed Permissions
    console.log('Seeding permissions...');
    const permissions = [
      { id: 'PERM_VIEW_DASHBOARD', name: 'View Dashboard', description: 'Access dashboard analytics' },
      { id: 'PERM_VIEW_PRODUCTS', name: 'View Products', description: 'View product catalog' },
      { id: 'PERM_CREATE_PRODUCT', name: 'Create Product', description: 'Add new products' },
      { id: 'PERM_EDIT_PRODUCT', name: 'Edit Product', description: 'Modify existing products' },
      { id: 'PERM_DELETE_PRODUCT', name: 'Delete Product', description: 'Remove products' },
      { id: 'PERM_ADJUST_STOCK', name: 'Adjust Stock', description: 'Manual stock adjustments' },
      { id: 'PERM_MANAGE_CATEGORIES', name: 'Manage Categories', description: 'CRUD categories' },
      { id: 'PERM_SELL', name: 'Sell', description: 'Process sales at POS' },
      { id: 'PERM_VIEW_SALES', name: 'View All Sales', description: 'View all sales transactions' },
      { id: 'PERM_VIEW_OWN_SALES', name: 'View Own Sales', description: 'View only own sales' },
      { id: 'PERM_REFUND', name: 'Refund', description: 'Process returns and refunds' },
      { id: 'PERM_MANAGE_PURCHASES', name: 'Manage Purchases', description: 'Create and manage purchase orders' },
      { id: 'PERM_MANAGE_SUPPLIERS', name: 'Manage Suppliers', description: 'CRUD suppliers' },
      { id: 'PERM_MANAGE_CUSTOMERS', name: 'Manage Customers', description: 'CRUD customers' },
      { id: 'PERM_MANAGE_EXPENSES', name: 'Manage Expenses', description: 'Record and manage expenses' },
      { id: 'PERM_MANAGE_CASHDRAWER', name: 'Manage Cash Drawer', description: 'Open/close shifts' },
      { id: 'PERM_VIEW_PROFIT', name: 'View Profit', description: 'Access profit reports' },
      { id: 'PERM_VIEW_REPORTS', name: 'View Reports', description: 'Access financial reports' },
      { id: 'PERM_MANAGE_USERS', name: 'Manage Users', description: 'CRUD users and roles' },
      { id: 'PERM_VIEW_AUDIT_LOGS', name: 'View Audit Logs', description: 'Access audit trail' },
      { id: 'PERM_MANAGE_SETTINGS', name: 'Manage Settings', description: 'Modify system settings' }
    ];
    
    for (const perm of permissions) {
      await client.query(
        'INSERT INTO permissions (id, name, description) VALUES ($1, $2, $3)',
        [perm.id, perm.name, perm.description]
      );
    }
    
    // 3. Seed Role-Permissions
    console.log('Seeding role permissions...');
    const rolePermissions = {
      ROLE_OWNER: permissions.map(p => p.id),
      ROLE_PHARMACIST: [
        'PERM_VIEW_DASHBOARD', 'PERM_VIEW_PRODUCTS', 'PERM_CREATE_PRODUCT', 'PERM_EDIT_PRODUCT',
        'PERM_DELETE_PRODUCT', 'PERM_ADJUST_STOCK', 'PERM_MANAGE_CATEGORIES', 'PERM_SELL',
        'PERM_VIEW_SALES', 'PERM_REFUND', 'PERM_MANAGE_PURCHASES', 'PERM_MANAGE_SUPPLIERS',
        'PERM_MANAGE_CUSTOMERS', 'PERM_MANAGE_EXPENSES', 'PERM_MANAGE_CASHDRAWER',
        'PERM_VIEW_PROFIT', 'PERM_VIEW_REPORTS', 'PERM_VIEW_AUDIT_LOGS'
      ],
      ROLE_CASHIER: [
        'PERM_VIEW_DASHBOARD', 'PERM_VIEW_PRODUCTS', 'PERM_SELL', 'PERM_VIEW_OWN_SALES',
        'PERM_REFUND', 'PERM_MANAGE_CASHDRAWER', 'PERM_MANAGE_CUSTOMERS'
      ]
    };
    
    for (const [roleId, permIds] of Object.entries(rolePermissions)) {
      for (const permId of permIds) {
        await client.query(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
          [roleId, permId]
        );
      }
    }
    
    // 4. Seed Admin User
    console.log('Seeding admin user...');
    const adminId = 'USR000001';
    const adminHash = await hashPassword('ChangeMe123');
    
    await client.query(
      `INSERT INTO users (id, username, password_hash, name, role_id, email, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [adminId, 'admin', adminHash, 'System Administrator', 'ROLE_OWNER', 'admin@pharmacy.com', true]
    );
    
    // 5. Seed Categories
    console.log('Seeding categories...');
    const categories = [
      { id: 'CAT000001', name: 'Antibiotics', description: 'Antibiotic medications' },
      { id: 'CAT000002', name: 'Analgesics', description: 'Pain relief medications' },
      { id: 'CAT000003', name: 'Vitamins', description: 'Vitamin supplements' },
      { id: 'CAT000004', name: 'Antihistamines', description: 'Allergy medications' },
      { id: 'CAT000005', name: 'Antacids', description: 'Acid reflux medications' }
    ];
    
    for (const cat of categories) {
      await client.query(
        'INSERT INTO categories (id, name, description) VALUES ($1, $2, $3)',
        [cat.id, cat.name, cat.description]
      );
    }
    
    // 6. Seed Suppliers
    console.log('Seeding suppliers...');
    const suppliers = [
      { id: 'SUP000001', name: 'MediSupply Co.', contact_person: 'John Smith', phone: '+1-555-0100', email: 'orders@medisupply.com', address: '123 Medical Ave, City', tax_number: 'TAX001', payment_terms: 30 },
      { id: 'SUP000002', name: 'PharmaDistributors Inc.', contact_person: 'Jane Doe', phone: '+1-555-0200', email: 'sales@pharmadist.com', address: '456 Pharma Blvd, City', tax_number: 'TAX002', payment_terms: 45 },
      { id: 'SUP000003', name: 'HealthCare Wholesale', contact_person: 'Bob Wilson', phone: '+1-555-0300', email: 'info@healthcarewholesale.com', address: '789 Health St, City', tax_number: 'TAX003', payment_terms: 30 }
    ];
    
    for (const sup of suppliers) {
      await client.query(
        `INSERT INTO suppliers (id, name, contact_person, phone, email, address, tax_number, payment_terms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sup.id, sup.name, sup.contact_person, sup.phone, sup.email, sup.address, sup.tax_number, sup.payment_terms]
      );
    }
    
    // 7. Seed Products
    console.log('Seeding products...');
    const products = [
      {
        id: 'MED000001', name: 'Amoxicillin 500mg', category_id: 'CAT000001', supplier_id: 'SUP000001',
        purchase_price: 8.00, selling_price: 10.00, tax_rate: 0, reorder_level: 50,
        default_margin: 25, pills_per_unit: 21, sell_by_pill: true
      },
      {
        id: 'MED000002', name: 'Paracetamol 500mg', category_id: 'CAT000002', supplier_id: 'SUP000001',
        purchase_price: 2.00, selling_price: 3.50, tax_rate: 0, reorder_level: 100,
        default_margin: 75, pills_per_unit: 20, sell_by_pill: true
      },
      {
        id: 'MED000003', name: 'Vitamin C 1000mg', category_id: 'CAT000003', supplier_id: 'SUP000002',
        purchase_price: 15.00, selling_price: 22.00, tax_rate: 0, reorder_level: 30,
        default_margin: 45, pills_per_unit: 30, sell_by_pill: false
      },
      {
        id: 'MED000004', name: 'Cetirizine 10mg', category_id: 'CAT000004', supplier_id: 'SUP000002',
        purchase_price: 5.00, selling_price: 8.00, tax_rate: 0, reorder_level: 50,
        default_margin: 60, pills_per_unit: 10, sell_by_pill: true
      },
      {
        id: 'MED000005', name: 'Omeprazole 20mg', category_id: 'CAT000005', supplier_id: 'SUP000003',
        purchase_price: 12.00, selling_price: 18.00, tax_rate: 0, reorder_level: 40,
        default_margin: 50, pills_per_unit: 14, sell_by_pill: false
      }
    ];
    
    for (const prod of products) {
      await client.query(
        `INSERT INTO products (id, name, category_id, supplier_id, purchase_price, selling_price,
         tax_rate, reorder_level, default_margin, pills_per_unit, sell_by_pill)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [prod.id, prod.name, prod.category_id, prod.supplier_id, prod.purchase_price,
         prod.selling_price, prod.tax_rate, prod.reorder_level, prod.default_margin,
         prod.pills_per_unit, prod.sell_by_pill]
      );
    }
    
    // 8. Seed Initial Batches and Inventory
    console.log('Seeding batches and inventory...');
    const batches = [
      { id: 'BAT000001', product_id: 'MED000001', supplier_id: 'SUP000001', quantity: 100, purchase_price: 8.00, selling_price: 10.00, expiry_date: '2026-12-31' },
      { id: 'BAT000002', product_id: 'MED000002', supplier_id: 'SUP000001', quantity: 200, purchase_price: 2.00, selling_price: 3.50, expiry_date: '2026-11-30' },
      { id: 'BAT000003', product_id: 'MED000003', supplier_id: 'SUP000002', quantity: 50, purchase_price: 15.00, selling_price: 22.00, expiry_date: '2027-01-15' },
      { id: 'BAT000004', product_id: 'MED000004', supplier_id: 'SUP000002', quantity: 80, purchase_price: 5.00, selling_price: 8.00, expiry_date: '2026-10-31' },
      { id: 'BAT000005', product_id: 'MED000005', supplier_id: 'SUP000003', quantity: 60, purchase_price: 12.00, selling_price: 18.00, expiry_date: '2026-12-15' }
    ];
    
    for (const batch of batches) {
      await client.query(
        `INSERT INTO batches (id, product_id, supplier_id, quantity, purchase_price, selling_price, expiry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batch.id, batch.product_id, batch.supplier_id, batch.quantity, batch.purchase_price, batch.selling_price, batch.expiry_date]
      );
      
      // Insert stock movement
      await client.query(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, previous_stock, new_stock, reference_type, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [batch.product_id, batch.id, 'Purchase', batch.quantity, 0, batch.quantity, 'InitialStock', adminId]
      );
    }
    
    // Insert inventory records
    for (const prod of products) {
      const batch = batches.find(b => b.product_id === prod.id);
      await client.query(
        `INSERT INTO inventory (product_id, current_stock, loose_pills)
         VALUES ($1, $2, $3)`,
        [prod.id, batch.quantity, 0]
      );
    }
    
    // 9. Seed Settings
    console.log('Seeding settings...');
    const settings = [
      { key: 'LowStockAlertThreshold', value: '10', description: 'Default low stock alert threshold' },
      { key: 'MarginPresets', value: '20,25,30,35,40', description: 'Available margin presets for POS' },
      { key: 'Currency', value: 'USD', description: 'System currency' },
      { key: 'TaxRate', value: '0', description: 'Default tax rate percentage' },
      { key: 'ReceiptFooter', value: 'Thank you for your business!', description: 'Footer text on receipts' }
    ];
    
    for (const setting of settings) {
      await client.query(
        'INSERT INTO settings (key, value, description) VALUES ($1, $2, $3)',
        [setting.key, setting.value, setting.description]
      );
    }
    
    // 10. Seed Business Info
    console.log('Seeding business info...');
    await client.query(
      `INSERT INTO business_info (id, name, address, phone, email, tax_number, receipt_footer)
       VALUES (1, $1, $2, $3, $4, $5, $6)`,
      ['Pharmacy ERP', '123 Main Street, City', '+1-555-0000', 'info@pharmacy.com', 'TAX123456', 'Thank you for your business!']
    );
    
    await client.query('COMMIT');
    console.log('Database seeding completed successfully!');
    console.log('\nDefault login credentials:');
    console.log('Username: admin');
    console.log('Password: ChangeMe123');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();