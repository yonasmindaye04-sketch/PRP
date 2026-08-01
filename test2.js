
var session = null;
var allProducts = [], allCategories = [], allSuppliers = [], allCustomers = [], allRoles = [], allPurchases = [];
var cart = [];
var editingProductId = null;
var purchaseLineCount = 0;
var currentSaleDetailsId = null;
var cachedSettings = null, cachedBusiness = null;
var marginPresets = [20, 25, 35];

function call(fn){
  var args = Array.prototype.slice.call(arguments,1);
  return new Promise(function(resolve,reject){
    google.script.run.withSuccessHandler(function(res){
      // google.script.run can resolve with null (dropped connection, huge
      // payload, etc.) — normalize that into a proper fail() shape so every
      // .then(res => res.success) call site downstream is always safe.
      if(res===null||res===undefined){ resolve({success:false, message:'No response from the server — please try again.'}); }
      else { resolve(res); }
    }).withFailureHandler(function(err){
      reject(err && err.message ? err.message : String(err));
    })[fn].apply(null,args);
  });
}
// Prevents a button from firing twice from a rapid double-click/tap while
// its action is still in flight. fn must return a Promise (or nothing).
function runGuarded(btn, fn){
  if(!btn || btn.dataset.busy==='1') return;
  btn.dataset.busy='1';
  btn.disabled=true;
  var originalText=btn.textContent;
  var restore=function(){ btn.dataset.busy=''; btn.disabled=false; btn.textContent=originalText; };
  var result;
  try{ result=fn(); }
  catch(e){ restore(); throw e; }
  if(result && typeof result.then==='function'){ result.then(restore, restore); }
  else { restore(); }
}
function toast(msg,isError){
  var t=document.getElementById('toast');
  t.textContent=msg; t.className='toast active'+(isError?' error':'');
  setTimeout(function(){t.className='toast';},3200);
}
function money(n){ return Number(n||0).toFixed(2); }
function esc(str){ return String(str==null?'':str).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];}); }
function can(permId){ return session && session.permissions && session.permissions.indexOf(permId) > -1; }

// ── Global error handler → reports to server ──────────────────────────────
window.addEventListener('error', function(e){
  google.script.run.reportClientError({
    message: e.message,
    stack: e.error && e.error.stack,
    context: 'window.onerror',
    userAgent: navigator.userAgent,
    url: window.location.href
  });
});
window.addEventListener('unhandledrejection', function(e){
  google.script.run.reportClientError({
    message: e.reason && e.reason.message ? e.reason.message : String(e.reason),
    stack: e.reason && e.reason.stack,
    context: 'unhandledrejection',
    userAgent: navigator.userAgent,
    url: window.location.href
  });
});

// ── Login ──────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', function(e){
  e.preventDefault();
  var btn=document.getElementById('login-btn'), msgEl=document.getElementById('login-msg');
  msgEl.innerHTML=''; btn.disabled=true; btn.textContent='Signing in…';
  var username=document.getElementById('login-username').value.trim();
  var password=document.getElementById('login-password').value;
  call('login',username,password).then(function(res){
    btn.disabled=false; btn.textContent='Sign in';
    if(!res.success){ msgEl.innerHTML='<div class="msg error">'+res.message+'</div>'; return; }
    session={userId:res.userId,name:res.name,roleId:res.roleId,roleName:res.roleName,permissions:res.permissions};
    enterApp();
  }).catch(function(err){ btn.disabled=false; btn.textContent='Sign in'; msgEl.innerHTML='<div class="msg error">'+err+'</div>'; });
});
document.getElementById('logout-btn').addEventListener('click', function(){
  session=null;
  document.getElementById('app-shell').classList.remove('active');
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('login-password').value='';
});

function openSidebar(){ document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebar-backdrop').classList.add('active'); }
function closeSidebar(){ document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-backdrop').classList.remove('active'); }
document.getElementById('hamburger-btn').addEventListener('click', openSidebar);
document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

function enterApp(){
  try {
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app-shell').classList.add('active');
    document.getElementById('chip-name').textContent=session.name;
    document.getElementById('chip-role').textContent=session.roleName;

    document.querySelectorAll('.nav-item[data-perm]').forEach(function(btn){
      btn.style.display = can(btn.getAttribute('data-perm')) ? 'flex' : 'none';
    });
    
    var addProdBtn = document.getElementById('add-product-btn');
    if (addProdBtn) {
      addProdBtn.style.display = can('PERM_CREATE_PRODUCT') ? 'inline-block' : 'none';
    }

    loadDashboard();
    loadCategories();
    loadSuppliers();
    loadCustomers();
    loadProducts();
    loadMarginPresets();
  } catch (err) {
    document.getElementById('login-screen').style.display='flex';
    document.getElementById('app-shell').classList.remove('active');
    document.getElementById('login-msg').innerHTML='<div class="msg error">App initialization failed: '+err.message+'</div>';
    console.error(err);
  }
}

document.querySelectorAll('.nav-item[data-view]').forEach(function(btn){
  btn.addEventListener('click', function(){
    if(btn.style.display==='none') return;
    document.querySelectorAll('.nav-item').forEach(function(b){b.classList.remove('active');});
    btn.classList.add('active');
    var view=btn.getAttribute('data-view');
    document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active');});
    document.getElementById('view-'+view).classList.add('active');
    if(view==='dashboard') loadDashboard();
    if(view==='pos') loadProducts();
    if(view==='inventory') loadProducts();
    if(view==='salesHistory') loadSalesHistory();
    if(view==='purchases') loadPurchases();
    if(view==='suppliers') loadSuppliers(true);
    if(view==='customers') loadCustomers(true);
    if(view==='finance') { loadExpenses(); loadIncome(); loadPayments(); }
    if(view==='cashdrawer') loadDrawer();
    if(view==='users') loadUsers();
    if(view==='settings') loadSettings();
    closeSidebar();
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────
function loadDashboard(){
  call('getDashboardSummary',session.userId).then(function(res){
    if(!res.success) return toast(res.message,true);
    var s=res.summary;
    var html =
      '<div class="card"><div class="label">Today\'s Sales</div><div class="value">'+money(s.todaysSalesTotal)+'</div></div>'+
      '<div class="card"><div class="label">Transactions Today</div><div class="value">'+s.todaysTransactionCount+'</div></div>'+
      '<div class="card"><div class="label">Active Products</div><div class="value">'+s.totalProducts+'</div></div>'+
      '<div class="card '+(s.lowStockCount>0?'warn':'')+'"><div class="label">Low Stock</div><div class="value">'+s.lowStockCount+'</div></div>'+
      '<div class="card '+(s.expiringSoonCount>0?'warn':'')+'"><div class="label">Expiring Soon</div><div class="value">'+s.expiringSoonCount+'</div></div>';
    if(s.todaysProfit!==undefined) html+='<div class="card"><div class="label">Today\'s Profit</div><div class="value">'+money(s.todaysProfit)+'</div></div>';
    document.getElementById('dashboard-cards').innerHTML=html;
  }).catch(function(err){toast(err,true);});

  call('getLowStockProducts',session.userId).then(function(res){
    var el=document.getElementById('dashboard-lowstock');
    if(!res.success){el.innerHTML='';return;}
    if(!res.products.length){el.innerHTML='<div class="empty-state">Nothing low on stock</div>';return;}
    el.innerHTML='<table><thead><tr><th>Product</th><th>Stock</th><th>Reorder level</th></tr></thead><tbody>'+
      res.products.map(function(p){return '<tr><td>'+esc(p.ProductName)+'</td><td>'+p.CurrentStock+'</td><td>'+p.ReorderLevel+'</td></tr>';}).join('')+'</tbody></table>';
  });

  call('getExpiringBatches',session.userId,90).then(function(res){
    var el=document.getElementById('dashboard-expiring');
    if(!res.success){el.innerHTML='';return;}
    if(!res.batches.length){el.innerHTML='<div class="empty-state">No batches expiring soon</div>';return;}
    el.innerHTML='<table><thead><tr><th>Product</th><th>Batch</th><th>Qty</th><th>Expiry</th></tr></thead><tbody>'+
      res.batches.map(function(b){return '<tr><td>'+esc(b.ProductName)+'</td><td>'+b.BatchNumber+'</td><td>'+b.Quantity+'</td><td>'+b.ExpiryDate+'</td></tr>';}).join('')+'</tbody></table>';
  });

  call('getSalesTrend',session.userId,14).then(function(res){
    if(!res.success) return;
    renderVBarChart('chart-sales-trend', res.trend, 'label', 'total');
  }).catch(function(){});

  call('getTopProducts',session.userId,30,5).then(function(res){
    if(!res.success) return;
    renderHBarChart('chart-top-products', res.products, 'name', 'total');
  }).catch(function(){});

  if(can('PERM_VIEW_PROFIT')){
    call('getCategoryBreakdown',session.userId,30).then(function(res){
      if(!res.success) return;
      document.getElementById('panel-category-breakdown').style.display = res.breakdown.length ? 'block' : 'none';
      renderHBarChart('chart-category-breakdown', res.breakdown, 'name', 'total');
    }).catch(function(){});
  }

  if(can('PERM_VIEW_PROFIT')){
    call('getPeriodComparison',session.userId).then(function(res){
      if(!res.success) return;
      var c=res.comparison;
      var momUp=c.momChangePct>=0, yoyUp=c.yoyChangePct>=0;
      document.getElementById('dashboard-comparison-cards').style.display='grid';
      document.getElementById('dashboard-comparison-cards').innerHTML=
        '<div class="card"><div class="label">This Month</div><div class="value">$'+money(c.thisMonth)+'</div>'+
          '<div style="font-size:12px;font-weight:700;color:'+(momUp?'var(--primary-dark)':'var(--danger)')+';margin-top:4px;">'+(momUp?'▲ ':'▼ ')+Math.abs(c.momChangePct)+'% vs last month</div></div>'+
        '<div class="card"><div class="label">Last Month</div><div class="value">$'+money(c.lastMonth)+'</div></div>'+
        '<div class="card"><div class="label">This Year (to date)</div><div class="value">$'+money(c.thisYear)+'</div>'+
          '<div style="font-size:12px;font-weight:700;color:'+(yoyUp?'var(--primary-dark)':'var(--danger)')+';margin-top:4px;">'+(yoyUp?'▲ ':'▼ ')+Math.abs(c.yoyChangePct)+'% vs last year</div></div>'+
        '<div class="card"><div class="label">Last Year (same period)</div><div class="value">$'+money(c.lastYear)+'</div></div>';
    }).catch(function(){});

    call('getProfitTrend',session.userId,14).then(function(res){
      if(!res.success) return;
      document.getElementById('panel-profit-trend').style.display='block';
      renderVBarChart('chart-profit-trend', res.trend, 'label', 'profit');
    }).catch(function(){});
  }
}

// Minimal dependency-free bar charts built from plain divs.
function renderVBarChart(containerId, items, labelKey, valueKey){
  var el=document.getElementById(containerId);
  if(!items || !items.length){ el.innerHTML='<div class="empty-state">No data yet</div>'; return; }
  var maxAbs=Math.max.apply(null, items.map(function(i){return Math.abs(Number(i[valueKey])||0);}))||1;
  el.innerHTML='<div class="vbar-chart">'+items.map(function(i){
    var v=Number(i[valueKey])||0;
    var pct=Math.max(2, Math.round(Math.abs(v)/maxAbs*100));
    var color=v<0?'background:var(--danger);':'';
    return '<div class="vbar-col"><span class="vbar-value">'+(v!==0?money(v):'')+'</span><div class="vbar" style="height:'+pct+'%;'+color+'"></div><div class="vbar-label">'+esc(i[labelKey])+'</div></div>';
  }).join('')+'</div>';
}
function renderHBarChart(containerId, items, labelKey, valueKey){
  var el=document.getElementById(containerId);
  if(!items || !items.length){ el.innerHTML='<div class="empty-state">No data yet</div>'; return; }
  var max=Math.max.apply(null, items.map(function(i){return Number(i[valueKey])||0;}))||1;
  el.innerHTML=items.map(function(i){
    var v=Number(i[valueKey])||0;
    var pct=Math.max(2, Math.round(v/max*100));
    return '<div class="hbar-row"><div class="hbar-label" title="'+esc(i[labelKey])+'">'+esc(i[labelKey])+'</div>'+
      '<div class="hbar-track"><div class="hbar-fill" style="width:'+pct+'%;"></div></div>'+
      '<div class="hbar-value">'+money(v)+'</div></div>';
  }).join('');
}

// ── Shared master data loaders ───────────────────────────────────────────
function loadCategories(){
  call('getCategories',session.userId).then(function(res){
    if(!res.success) return;
    allCategories=res.categories;
    var sel=document.getElementById('pf-category');
    sel.innerHTML=allCategories.map(function(c){return '<option value="'+c.CategoryID+'">'+esc(c.CategoryName)+'</option>';}).join('');
    var posSel=document.getElementById('pos-category-filter');
    posSel.innerHTML='<option value="">All categories</option>'+allCategories.map(function(c){return '<option value="'+c.CategoryID+'">'+esc(c.CategoryName)+'</option>';}).join('');
    var invSel=document.getElementById('inventory-category-filter');
    if(invSel) invSel.innerHTML='<option value="">All categories</option>'+allCategories.map(function(c){return '<option value="'+c.CategoryID+'">'+esc(c.CategoryName)+'</option>';}).join('');
    renderCategoryList();
  });
}
function loadSuppliers(renderTable){
  call('getSuppliers',session.userId).then(function(res){
    if(!res.success) return;
    allSuppliers=res.suppliers;
    ['pf-supplier','pu-supplier','pf-pay-supplier'].forEach(function(id){
      var sel=document.getElementById(id);
      var keepFirst = id==='pf-supplier';
      sel.innerHTML=(keepFirst?'<option value="">—</option>':'')+allSuppliers.map(function(s){return '<option value="'+s.SupplierID+'">'+esc(s.SupplierName)+'</option>';}).join('');
    });
    if(renderTable) renderSuppliersTable();
  });
}
function loadCustomers(renderTable){
  call('getCustomers',session.userId).then(function(res){
    if(!res.success) return;
    allCustomers=res.customers;
    var sel=document.getElementById('pos-customer');
    sel.innerHTML='<option value="">Walk-in</option>'+allCustomers.map(function(c){return '<option value="'+c.CustomerID+'">'+esc(c.FullName)+'</option>';}).join('');
    if(renderTable) renderCustomersTable();
  });
}

// ── Products (POS + Inventory) ───────────────────────────────────────────
function loadProducts(){
  call('getProducts',session.userId).then(function(res){
    if(!res.success) return toast(res.message,true);
    allProducts=res.products;
    renderPosGrid(); renderInventoryTable();
    var dl = document.getElementById('products-datalist');
    if(!dl) {
      dl = document.createElement('datalist');
      dl.id = 'products-datalist';
      document.body.appendChild(dl);
    }
    dl.innerHTML = allProducts.map(function(p){ return '<option value="'+esc(p.ProductName)+'">'; }).join('');
  }).catch(function(err){toast(err,true);});
}
function loadMarginPresets(){
  call('getSettings',session.userId).then(function(res){
    if(res.success&&res.settings&&res.settings.MarginPresets){
      var presets=res.settings.MarginPresets.split(',').map(function(s){return Number(s.trim());}).filter(function(n){return!isNaN(n)&&n>0;});
      if(presets.length) marginPresets=presets;
    }
  }).catch(function(){});
}
function renderPosGrid(){
  var grid=document.getElementById('pos-product-grid');
  var filter=(document.getElementById('pos-search').value||'').toLowerCase();
  var catFilter=document.getElementById('pos-category-filter').value;
  var list=allProducts.filter(function(p){
    var matchesSearch=p.ProductName.toLowerCase().indexOf(filter)>-1;
    var matchesCat=!catFilter||p.CategoryID===catFilter;
    return matchesSearch&&matchesCat;
  });
  if(!list.length){grid.innerHTML='<div class="empty-state">No products found</div>';return;}

  if(catFilter||filter){
    // A specific category or search term is active — flat alphabetical list.
    list.sort(function(a,b){return a.ProductName.localeCompare(b.ProductName);});
    grid.innerHTML=list.map(posTileHtml).join('');
  } else {
    // No filter — group by category, categories alphabetical, products alphabetical within each.
    var groups={};
    list.forEach(function(p){ var key=p.CategoryName||'Uncategorized'; (groups[key]=groups[key]||[]).push(p); });
    var catNames=Object.keys(groups).sort();
    grid.innerHTML=catNames.map(function(cat){
      var items=groups[cat].slice().sort(function(a,b){return a.ProductName.localeCompare(b.ProductName);});
      return '<div class="pos-category-heading">'+esc(cat)+'</div><div class="product-grid">'+items.map(posTileHtml).join('')+'</div>';
    }).join('');
  }
}
function posTileHtml(p){
  var out=p.DisplayStock<=0;
  var stockLabel=p.SellByPill&&p.PillsPerUnit>0
    ? (out?'Out of stock':p.DisplayStock+' pills')
    : (out?'Out of stock':p.CurrentStock+' in stock');
  return '<button class="product-tile" '+(out?'disabled':'')+' onclick="addToCart(\''+p.ProductID+'\')">'+
    '<div class="p-name">'+esc(p.ProductName)+'</div>'+
    '<div class="p-meta">'+stockLabel+'</div>'+
    '<div class="p-price">$'+money(p.SellingPrice)+'</div></button>';
}
document.getElementById('pos-search').addEventListener('input',renderPosGrid);
document.getElementById('pos-category-filter').addEventListener('change',renderPosGrid);

function addToCart(productId){
  var product=allProducts.filter(function(p){return p.ProductID===productId;})[0];
  if(!product) return;
  var existing=cart.filter(function(c){return c.productId===productId;})[0];
  var currentQty=existing?existing.qty:0;
  var step=1;
  if(currentQty+step>product.DisplayStock){toast('Not enough stock.',true);return;}
  var margin=Number(product.DefaultMargin)||0;
  var unitPurchasePrice=Number(product.PurchasePrice)||0;
  var unitCatalogPrice=Number(product.SellingPrice)||0;
  var isPill=product.SellByPill===true||product.SellByPill==='TRUE';
  var ppu=isPill?Number(product.PillsPerUnit)||1:1;
  var pillPrice=margin>0?unitPurchasePrice*(1+margin/100):unitCatalogPrice;
  if(isPill) pillPrice=pillPrice/ppu;
  if(existing) existing.qty+=step;
  else cart.push({
    productId:product.ProductID,name:product.ProductName,
    price:pillPrice, catalogPrice:isPill?unitCatalogPrice/ppu:unitCatalogPrice,
    taxRate:Number(product.TaxRate)||0, qty:step, stock:product.DisplayStock,
    marginUsed:margin, purchasePrice:isPill?unitPurchasePrice/ppu:unitPurchasePrice,
    pillsPerUnit:ppu,
    sellByPill:isPill
  });
  renderCart();
}
function changeCartQty(productId,delta){
  var item=cart.filter(function(c){return c.productId===productId;})[0];
  if(!item) return;
  var newQty=item.qty+delta;
  if(newQty<=0) cart=cart.filter(function(c){return c.productId!==productId;});
  else if(newQty>item.stock){toast('Not enough stock.',true);return;}
  else item.qty=newQty;
  renderCart();
}
function changeCartMargin(productId,newMargin){
  var item=cart.filter(function(c){return c.productId===productId;})[0];
  if(!item) return;
  var margin=Number(newMargin)||0;
  item.marginUsed=margin;
  // item.purchasePrice and item.catalogPrice are already per-pill for SellByPill products
  // (they were divided by PillsPerUnit in addToCart), so this formula is correct for both cases.
  item.price=margin>0?item.purchasePrice*(1+margin/100):item.catalogPrice;
  renderCart();
}
function ppuFor(item){return item.pillsPerUnit||1;}
function updateSellByPillQty(productId){
  var item=cart.filter(function(c){return c.productId===productId;})[0];
  if(!item) return;
  var ppu=ppuFor(item);
  var unitsInput=document.getElementById('sbp-u-'+productId);
  var pillsInput=document.getElementById('sbp-p-'+productId);
  var u=Number(unitsInput.value)||0;
  var p=Number(pillsInput.value)||0;
  if(p>=ppu){u+=Math.floor(p/ppu);p=p%ppu;}
  var total=u*ppu+p;
  if(total<=0) cart=cart.filter(function(c){return c.productId!==productId;});
  else if(total>item.stock){toast('Not enough stock.',true);return;}
  else item.qty=total;
  renderCart();
}
function renderCart(){
  var el=document.getElementById('pos-cart');
  if(!cart.length){el.innerHTML='<div class="empty-state">Cart is empty</div>';}
  else{
    el.innerHTML=cart.map(function(c,idx){
      var priceLabel='$'+money(c.price)+' per pill';
      var controls='';
      if(c.sellByPill&&c.pillsPerUnit>0){
        var ppu=c.pillsPerUnit;
        var units=Math.floor(c.qty/ppu);
        var pills=c.qty%ppu;
        controls=
          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
            '<label style="font-size:11px;font-weight:600;">Units</label>'+
            '<input id="sbp-u-'+c.productId+'" type="number" min="0" value="'+units+'" style="width:50px;font-size:12px;padding:2px 4px;border:1px solid var(--line);border-radius:4px;" onchange="updateSellByPillQty(\''+c.productId+'\')" oninput="updateSellByPillQty(\''+c.productId+'\')">'+
            '<label style="font-size:11px;font-weight:600;">Pills</label>'+
            '<input id="sbp-p-'+c.productId+'" type="number" min="0" max="'+(ppu-1)+'" value="'+pills+'" style="width:50px;font-size:12px;padding:2px 4px;border:1px solid var(--line);border-radius:4px;" onchange="updateSellByPillQty(\''+c.productId+'\')" oninput="updateSellByPillQty(\''+c.productId+'\')">'+
            '<span style="font-size:10.5px;color:var(--ink-soft);">= '+c.qty+' pills</span>'+
          '</div>';
        priceLabel='$'+money(c.price)+' per pill · $'+money(c.price*ppu)+' per unit';
      } else {
        controls='<div class="qty-controls"><button onclick="changeCartQty(\''+c.productId+'\',-1)">−</button><span>'+c.qty+'</span><button onclick="changeCartQty(\''+c.productId+'\',1)">+</button></div>';
      }
      return '<div class="cart-item" style="flex-direction:column;align-items:stretch;gap:4px;">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;">'+
          '<div><b>'+esc(c.name)+'</b><br><span style="color:var(--ink-soft);font-size:11px;">'+priceLabel+'</span></div>'+
          controls+
        '</div>'+
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
          '<button class="mini-btn" style="padding:4px 8px;font-size:11px;" onclick="changeCartMargin(\''+c.productId+'\',0)" '+(c.marginUsed==0?'style="background:var(--primary);color:#fff;border-color:var(--primary);"':'')+'>Auto</button>'+
          '<button class="mini-btn" style="padding:4px 8px;font-size:11px;" onclick="changeCartMargin(\''+c.productId+'\',20)" '+(c.marginUsed==20?'style="background:var(--primary);color:#fff;border-color:var(--primary);"':'')+'>20%</button>'+
          '<button class="mini-btn" style="padding:4px 8px;font-size:11px;" onclick="changeCartMargin(\''+c.productId+'\',25)" '+(c.marginUsed==25?'style="background:var(--primary);color:#fff;border-color:var(--primary);"':'')+'>25%</button>'+
          '<button class="mini-btn" style="padding:4px 8px;font-size:11px;" onclick="changeCartMargin(\''+c.productId+'\',35)" '+(c.marginUsed==35?'style="background:var(--primary);color:#fff;border-color:var(--primary);"':'')+'>35%</button>'+
        '<div style="display:flex;gap:6px;align-items:center;">'+
          '<input type="number" step="0.1" value="'+c.marginUsed+'" style="width:60px;font-size:11px;padding:2px 4px;border:1px solid var(--line);border-radius:4px;" onchange="changeCartMargin(\''+c.productId+'\',this.value)">'+
          '<span style="font-size:10.5px;color:var(--ink-soft);">% margin</span>'+
        '</div>'+
        '</div>';
    }).join('');
  }
  var subtotal=cart.reduce(function(s,c){return s+c.qty*c.price;},0);
  var tax=cart.reduce(function(s,c){return s+c.qty*c.price*c.taxRate/100;},0);
  var discount=Number(document.getElementById('pos-discount').value)||0;
  var total=Math.max(0,subtotal-discount+tax);
  document.getElementById('pos-totals').innerHTML=
    '<div class="cart-total-row"><span>Subtotal</span><span>$'+money(subtotal)+'</span></div>'+
    '<div class="cart-total-row"><span>Tax</span><span>$'+money(tax)+'</span></div>'+
    '<div class="cart-total-row"><span>Discount</span><span>$'+money(discount)+'</span></div>'+
    '<div class="cart-total-row grand"><span>Total</span><span>$'+money(total)+'</span></div>';
}
document.getElementById('pos-discount').addEventListener('input',renderCart);

document.getElementById('pos-checkout-btn').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('pos-checkout-msg'); msgEl.innerHTML='';
  if(!cart.length){msgEl.innerHTML='<div class="msg error">Cart is empty.</div>';return;}
  self.textContent='Processing…';
  var payload=cart.map(function(c){return {productId:c.productId,qty:c.qty,unitPrice:c.price,marginUsed:c.marginUsed};});
  var options={
    discount:Number(document.getElementById('pos-discount').value)||0,
    paymentMethod:document.getElementById('pos-payment').value,
    customerId:document.getElementById('pos-customer').value
  };
  return call('createSale',session.userId,payload,options).then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    toast('Sale '+res.saleId+' completed — $'+money(res.total));
    msgEl.innerHTML='<div class="msg success">Sale '+res.saleId+' completed. <button class="mini-btn" onclick="printReceipt(\''+res.saleId+'\')">Print receipt</button></div>';
    cart=[]; document.getElementById('pos-discount').value=''; renderCart();
    loadProducts(); loadDashboard();
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});

// ── Inventory table ───────────────────────────────────────────────────────
function renderInventoryTable(){
  var tbody=document.getElementById('inventory-tbody');
  var filter=(document.getElementById('inventory-search').value||'').toLowerCase();
  var catFilter=document.getElementById('inventory-category-filter').value;
  var stockFilter=document.getElementById('inventory-stock-filter').value;
  var defaultLowStock=Number(document.getElementById('s-lowstock').value||0);

  var list=allProducts.filter(function(p){
    if(filter && p.ProductName.toLowerCase().indexOf(filter)===-1 && (p.GenericName||'').toLowerCase().indexOf(filter)===-1) return false;
    if(catFilter && p.CategoryID!==catFilter) return false;
    
    var threshold = (p.ReorderLevel !== undefined && p.ReorderLevel !== '' && Number(p.ReorderLevel) > 0) ? Number(p.ReorderLevel) : defaultLowStock;
    if(stockFilter==='out_of_stock' && p.CurrentStock>0) return false;
    if(stockFilter==='low_stock' && (p.CurrentStock<=0 || p.CurrentStock>threshold)) return false;
    if(stockFilter==='in_stock' && p.CurrentStock<=threshold) return false;
    
    return true;
  });

  if(!list.length){tbody.innerHTML='<tr><td colspan="6"><div class="empty-state">No products found</div></td></tr>';return;}
  tbody.innerHTML=list.map(function(p){
    var threshold = (p.ReorderLevel !== undefined && p.ReorderLevel !== '' && Number(p.ReorderLevel) > 0) ? Number(p.ReorderLevel) : defaultLowStock;
    var low=p.CurrentStock<=threshold;
    var actions='';
    if(can('PERM_EDIT_PRODUCT')) actions+='<button onclick="openProductModal(\''+p.ProductID+'\')">Edit</button>';
    if(can('PERM_DELETE_PRODUCT')) actions+='<button class="danger" onclick="removeProduct(\''+p.ProductID+'\')">Delete</button>';
    return '<tr><td>'+esc(p.ProductName)+'</td><td>'+esc(p.CategoryName)+'</td><td>$'+money(p.SellingPrice)+'</td><td>'+p.CurrentStock+'</td>'+
      '<td><span class="pill '+(low?'low':'ok')+'">'+(low?'Low stock':'In stock')+'</span></td><td class="row-actions">'+actions+'</td></tr>';
  }).join('');
}
document.getElementById('inventory-search').addEventListener('input',renderInventoryTable);
document.getElementById('inventory-category-filter').addEventListener('change',renderInventoryTable);
document.getElementById('inventory-stock-filter').addEventListener('change',renderInventoryTable);

function openProductModal(productId){
  editingProductId=productId||null;
  var product=productId?allProducts.filter(function(p){return p.ProductID===productId;})[0]:null;
  document.getElementById('product-modal-title').textContent=product?'Edit product':'Add product';
  document.getElementById('product-modal-msg').innerHTML='';
  document.getElementById('pf-name').value=product?product.ProductName:'';
  document.getElementById('pf-generic').value=product?product.GenericName:'';
  document.getElementById('pf-brand').value=product?product.Brand:'';
  document.getElementById('pf-category').value=product?product.CategoryID:'';
  document.getElementById('pf-unit').value=product?product.Unit:'';
  document.getElementById('pf-strength').value=product?product.Strength:'';
  document.getElementById('pf-dosageform').value=product?product.DosageForm:'';
  document.getElementById('pf-supplier').value=product?product.SupplierID:'';
  document.getElementById('pf-purchaseprice').value=product?product.PurchasePrice:'';
  document.getElementById('pf-sellingprice').value=product?product.SellingPrice:'';
  document.getElementById('pf-taxrate').value=product?product.TaxRate:'0';
  document.getElementById('pf-defaultmargin').value=product?product.DefaultMargin:'';
  document.getElementById('pf-pillsperunit').value=product?product.PillsPerUnit:'';
  document.getElementById('pf-sellbypill').checked=product?(product.SellByPill===true||product.SellByPill==='TRUE'):false;
  document.getElementById('pf-reorderlevel').value=product?product.ReorderLevel:'';
  document.getElementById('pf-minstock').value=product?product.MinimumStock:'';
  document.getElementById('pf-maxstock').value=product?product.MaximumStock:'';
  document.getElementById('pf-openingqty').value='';
  document.getElementById('pf-expiry').value='';
  document.getElementById('pf-openingqty-field').style.display=product?'none':'block';
  document.getElementById('pf-expiry-field').style.display=product?'none':'block';
  document.getElementById('product-modal').classList.add('active');
  updatePillPreview();
}
document.getElementById('add-product-btn').addEventListener('click',function(){openProductModal(null);});
document.getElementById('product-modal-cancel').addEventListener('click',function(){document.getElementById('product-modal').classList.remove('active');});
document.getElementById('pf-sellingprice').addEventListener('input', updatePillPreview);
document.getElementById('pf-purchaseprice').addEventListener('input', updatePillPreview);

function updatePillPreview(){
  var isChecked = document.getElementById('pf-sellbypill').checked;
  var section = document.getElementById('pf-pill-section');
  section.style.display = isChecked ? 'block' : 'none';
  if(!isChecked) return;

  var ppu = Number(document.getElementById('pf-pillsperunit').value) || 0;
  var sellingPrice = Number(document.getElementById('pf-sellingprice').value) || 0;
  var purchasePrice = Number(document.getElementById('pf-purchaseprice').value) || 0;
  var preview = document.getElementById('pf-pill-preview');

  if(!ppu || !sellingPrice){
    preview.innerHTML = '<span style="color:var(--ink-soft);">Enter the number of pills and selling price to see the preview.</span>';
    return;
  }

  var pricePerPill = sellingPrice / ppu;
  var costPerPill = purchasePrice > 0 ? purchasePrice / ppu : null;
  var margin = purchasePrice > 0 && sellingPrice > 0 ? ((sellingPrice - purchasePrice) / purchasePrice * 100) : null;

  preview.innerHTML =
    '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">💊 Price Preview</div>'+
    '<table style="width:100%;font-size:12px;border-collapse:collapse;">'+
      '<tr><td style="color:var(--ink-soft);padding:2px 0;">Sealed unit ('+ppu+' pills)</td><td style="text-align:right;font-weight:600;">'+money(sellingPrice)+' ETB</td></tr>'+
      '<tr><td style="color:var(--ink-soft);padding:2px 0;">Per individual pill</td><td style="text-align:right;font-weight:700;color:var(--brand);">'+money(pricePerPill)+' ETB</td></tr>'+
      (costPerPill!==null?'<tr><td style="color:var(--ink-soft);padding:2px 0;">Cost per pill</td><td style="text-align:right;">'+money(costPerPill)+' ETB</td></tr>':'')+
      (margin!==null?'<tr><td style="color:var(--ink-soft);padding:2px 0;">Unit margin</td><td style="text-align:right;color:'+(margin>=0?'#2e7d32':'#c62828')+';">'+money(margin)+'%</td></tr>':'')+
    '</table>'+
    '<div style="margin-top:8px;font-size:11px;color:var(--ink-soft);">Example: customer buys 3 pills → <strong>'+money(pricePerPill*3)+' ETB</strong></div>';
}
document.getElementById('product-modal-save').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('product-modal-msg');
  var payload={
    productId:editingProductId,
    productName:document.getElementById('pf-name').value.trim(),
    genericName:document.getElementById('pf-generic').value.trim(),
    brand:document.getElementById('pf-brand').value.trim(),
    categoryId:document.getElementById('pf-category').value,
    unit:document.getElementById('pf-unit').value.trim(),
    strength:document.getElementById('pf-strength').value.trim(),
    dosageForm:document.getElementById('pf-dosageform').value.trim(),
    supplierId:document.getElementById('pf-supplier').value,
    purchasePrice:document.getElementById('pf-purchaseprice').value,
    sellingPrice:document.getElementById('pf-sellingprice').value,
    taxRate:document.getElementById('pf-taxrate').value,
    defaultMargin:document.getElementById('pf-defaultmargin').value,
    pillsPerUnit:document.getElementById('pf-pillsperunit').value,
    sellByPill:document.getElementById('pf-sellbypill').checked,
    reorderLevel:document.getElementById('pf-reorderlevel').value,
    minimumStock:document.getElementById('pf-minstock').value,
    maximumStock:document.getElementById('pf-maxstock').value,
    openingStock:document.getElementById('pf-openingqty').value,
    expiryDate:document.getElementById('pf-expiry').value.trim()
  };
  if(!payload.productName||payload.sellingPrice===''){msgEl.innerHTML='<div class="msg error">Name and selling price are required.</div>';return;}
  var promise=editingProductId?call('updateProduct',session.userId,payload):call('createProduct',session.userId,payload);
  return promise.then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('product-modal').classList.remove('active');
    toast('Product saved.'); 
    
    call('getProducts',session.userId).then(function(res2){
      if(!res2.success) return;
      allProducts=res2.products;
      renderPosGrid(); renderInventoryTable();
      var dl = document.getElementById('products-datalist');
      if(dl) dl.innerHTML = allProducts.map(function(p){ return '<option value="'+esc(p.ProductName)+'">'; }).join('');
      
      if(window.activePurchaseLineForNewProduct && res.productId) {
        var newProd = allProducts.find(function(p){ return p.ProductID === res.productId; });
        if(newProd) {
          var input = window.activePurchaseLineForNewProduct.querySelector('.pl-product-search');
          if(input) {
            input.value = newProd.ProductName;
            input.dispatchEvent(new Event('input', {bubbles:true}));
          }
        }
        window.activePurchaseLineForNewProduct = null;
      }
    });
    
    loadDashboard();
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});
function removeProduct(productId){
  if(!confirm('Deactivate this product?')) return;
  call('deleteProduct',session.userId,productId).then(function(res){
    if(!res.success) return toast(res.message,true);
    toast('Product deactivated.'); loadProducts(); loadDashboard();
  }).catch(function(err){toast(err,true);});
}

// ── Categories modal ─────────────────────────────────────────────────────
document.getElementById('manage-categories-btn').addEventListener('click',function(){
  document.getElementById('category-modal-msg').innerHTML='';
  document.getElementById('category-modal').classList.add('active');
});
document.getElementById('category-modal-close').addEventListener('click',function(){document.getElementById('category-modal').classList.remove('active');});
function renderCategoryList(){
  var el=document.getElementById('category-list');
  if(!allCategories.length){el.innerHTML='<div class="empty-state">No categories yet</div>';return;}
  el.innerHTML=allCategories.map(function(c){return '<span class="tag">'+esc(c.CategoryName)+'</span>';}).join(' ');
}
document.getElementById('category-modal-add').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('category-modal-msg');
  var name=document.getElementById('cat-name').value.trim();
  if(!name){msgEl.innerHTML='<div class="msg error">Category name is required.</div>';return;}
  return call('createCategory',session.userId,{categoryName:name,description:document.getElementById('cat-desc').value.trim()}).then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('cat-name').value=''; document.getElementById('cat-desc').value='';
    toast('Category added.'); loadCategories();
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});

// ── Suppliers ─────────────────────────────────────────────────────────────
function renderSuppliersTable(){
  var tbody=document.getElementById('suppliers-tbody');
  if(!allSuppliers.length){tbody.innerHTML='<tr><td colspan="5"><div class="empty-state">No suppliers yet</div></td></tr>';return;}
  tbody.innerHTML=allSuppliers.map(function(s){
    return '<tr><td>'+esc(s.SupplierName)+'</td><td>'+esc(s.ContactPerson||'—')+'</td><td>'+esc(s.Phone||'—')+'</td><td>$'+money(s.CurrentBalance)+'</td>'+
      '<td class="row-actions"><button onclick="openSupplierModal(\''+s.SupplierID+'\')">Edit</button></td></tr>';
  }).join('');
}
function openSupplierModal(supplierId){
  var s=supplierId?allSuppliers.filter(function(x){return x.SupplierID===supplierId;})[0]:null;
  document.getElementById('supplier-modal-title').textContent=s?'Edit supplier':'Add supplier';
  document.getElementById('supplier-modal-msg').innerHTML='';
  document.getElementById('sf-name').value=s?s.SupplierName:'';
  document.getElementById('sf-contact').value=s?s.ContactPerson:'';
  document.getElementById('sf-phone').value=s?s.Phone:'';
  document.getElementById('sf-email').value=s?s.Email:'';
  document.getElementById('sf-taxnumber').value=s?s.TaxNumber:'';
  document.getElementById('sf-paymentterms').value=s?s.PaymentTerms:'';
  document.getElementById('sf-address').value=s?s.Address:'';
  document.getElementById('sf-opening').value='';
  document.getElementById('sf-opening-field').style.display=s?'none':'block';
  document.getElementById('supplier-modal').dataset.editing=supplierId||'';
  document.getElementById('supplier-modal').classList.add('active');
}
document.getElementById('add-supplier-btn').addEventListener('click',function(){openSupplierModal(null);});
document.getElementById('supplier-modal-cancel').addEventListener('click',function(){document.getElementById('supplier-modal').classList.remove('active');});
document.getElementById('supplier-modal-save').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('supplier-modal-msg');
  var editing=document.getElementById('supplier-modal').dataset.editing;
  var payload={
    supplierId:editing||undefined, supplierName:document.getElementById('sf-name').value.trim(),
    contactPerson:document.getElementById('sf-contact').value.trim(), phone:document.getElementById('sf-phone').value.trim(),
    email:document.getElementById('sf-email').value.trim(), taxNumber:document.getElementById('sf-taxnumber').value.trim(),
    paymentTerms:document.getElementById('sf-paymentterms').value.trim(), address:document.getElementById('sf-address').value.trim(),
    openingBalance:document.getElementById('sf-opening').value
  };
  if(!payload.supplierName){msgEl.innerHTML='<div class="msg error">Supplier name is required.</div>';return;}
  var promise=editing?call('updateSupplier',session.userId,payload):call('createSupplier',session.userId,payload);
  return promise.then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('supplier-modal').classList.remove('active');
    toast('Supplier saved.'); loadSuppliers(true);
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});

// ── Customers ─────────────────────────────────────────────────────────────
function renderCustomersTable(){
  var tbody=document.getElementById('customers-tbody');
  if(!allCustomers.length){tbody.innerHTML='<tr><td colspan="5"><div class="empty-state">No customers yet</div></td></tr>';return;}
  tbody.innerHTML=allCustomers.map(function(c){
    return '<tr><td>'+esc(c.FullName)+'</td><td>'+esc(c.Phone||'—')+'</td><td>'+(c.LoyaltyPoints||0)+'</td><td>$'+money(c.CreditBalance)+'</td>'+
      '<td class="row-actions"><button onclick="openCustomerModal(\''+c.CustomerID+'\')">Edit</button></td></tr>';
  }).join('');
}
function openCustomerModal(customerId){
  var c=customerId?allCustomers.filter(function(x){return x.CustomerID===customerId;})[0]:null;
  document.getElementById('customer-modal-title').textContent=c?'Edit customer':'Add customer';
  document.getElementById('customer-modal-msg').innerHTML='';
  document.getElementById('cf-name').value=c?c.FullName:'';
  document.getElementById('cf-phone').value=c?c.Phone:'';
  document.getElementById('cf-email').value=c?c.Email:'';
  document.getElementById('cf-address').value=c?c.Address:'';
  document.getElementById('customer-modal').dataset.editing=customerId||'';
  document.getElementById('customer-modal').classList.add('active');
}
document.getElementById('add-customer-btn').addEventListener('click',function(){openCustomerModal(null);});
document.getElementById('customer-modal-cancel').addEventListener('click',function(){document.getElementById('customer-modal').classList.remove('active');});
document.getElementById('customer-modal-save').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('customer-modal-msg');
  var editing=document.getElementById('customer-modal').dataset.editing;
  var payload={
    customerId:editing||undefined, fullName:document.getElementById('cf-name').value.trim(),
    phone:document.getElementById('cf-phone').value.trim(), email:document.getElementById('cf-email').value.trim(),
    address:document.getElementById('cf-address').value.trim()
  };
  if(!payload.fullName){msgEl.innerHTML='<div class="msg error">Customer name is required.</div>';return;}
  var promise=editing?call('updateCustomer',session.userId,payload):call('createCustomer',session.userId,payload);
  return promise.then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('customer-modal').classList.remove('active');
    toast('Customer saved.'); loadCustomers(true);
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});

// ── Purchases ─────────────────────────────────────────────────────────────
function loadPurchases(){
  call('getPurchases',session.userId,100).then(function(res){
    var tbody=document.getElementById('purchases-tbody');
    if(!res.success){tbody.innerHTML='<tr><td colspan="7"><div class="empty-state">'+res.message+'</div></td></tr>';return;}
    allPurchases=res.purchases;
    if(!res.purchases.length){tbody.innerHTML='<tr><td colspan="7"><div class="empty-state">No purchases yet</div></td></tr>';return;}
    tbody.innerHTML=res.purchases.map(function(p){
      var isDeleted=p.RecordStatus==='Deleted';
      var statusLabel=isDeleted?'Deleted':p.PaymentStatus;
      var statusClass=isDeleted?'bad':(p.PaymentStatus==='Paid'?'ok':'low');
      var actions='<button onclick="openPurchaseDetails(\''+p.PurchaseID+'\')">View</button>';
      return '<tr style="'+(isDeleted?'opacity:.55;':'')+'"><td>'+p.PurchaseID+'</td><td>'+new Date(p.PurchaseDate).toLocaleDateString()+'</td><td>'+esc(p.SupplierName)+'</td>'+
        '<td>$'+money(p.GrandTotal)+'</td><td><span class="pill '+statusClass+'">'+statusLabel+'</span></td><td>$'+money(p.Balance)+'</td>'+
        '<td class="row-actions">'+actions+'</td></tr>';
    }).join('');
  }).catch(function(err){toast(err,true);});
}
function openPurchaseDetails(purchaseId){
  document.getElementById('pd-msg').innerHTML='';
  document.getElementById('pd-order-info').innerHTML='';
  document.getElementById('pd-supplier-info').innerHTML='';
  document.getElementById('pd-notes').innerHTML='';
  document.getElementById('pd-items').innerHTML='';
  document.getElementById('pd-totals').innerHTML='';
  document.getElementById('pd-payments').innerHTML='';
  document.getElementById('pd-deleted-banner').innerHTML='';
  document.getElementById('purchase-details-modal').dataset.purchaseId=purchaseId;
  document.getElementById('purchase-details-modal').querySelector('h3').innerHTML='Purchase <span id="pd-purchase-id"></span>';
  document.getElementById('pd-purchase-id').textContent=purchaseId;
  document.getElementById('purchase-details-modal').classList.add('active');
  call('getPurchaseDetails',session.userId,purchaseId).then(function(res){
    if(!res.success){document.getElementById('pd-msg').innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    var pur=res.purchase, items=res.items, payments=res.payments||[];

    var statusClass=pur.RecordStatus==='Deleted'?'bad':(pur.PaymentStatus==='Paid'?'ok':(pur.PaymentStatus==='Partial'?'low':'bad'));
    document.getElementById('pd-order-info').innerHTML=
      '<div><b>Date:</b> '+new Date(pur.PurchaseDate).toLocaleString()+'</div>'+
      '<div><b>Invoice:</b> '+esc(pur.InvoiceNumber||'—')+'</div>'+
      '<div><b>Recorded by:</b> '+esc(pur.ReceivedByName||pur.ReceivedBy)+'</div>'+
      '<div><b>Status:</b> <span class="pill '+statusClass+'">'+esc(pur.PaymentStatus||'—')+'</span>'+
        (pur.RecordStatus==='Deleted'?' <span class="pill bad">Deleted</span>':'')+'</div>';

    document.getElementById('pd-supplier-info').innerHTML=
      '<div><b>Name:</b> '+esc(pur.SupplierName)+'</div>'+
      (pur.SupplierPhone?'<div><b>Phone:</b> '+esc(pur.SupplierPhone)+'</div>':'')+
      (pur.SupplierEmail?'<div><b>Email:</b> '+esc(pur.SupplierEmail)+'</div>':'')+
      (pur.SupplierAddress?'<div><b>Address:</b> '+esc(pur.SupplierAddress)+'</div>':'')+
      (pur.SupplierTaxNumber?'<div><b>Tax #:</b> '+esc(pur.SupplierTaxNumber)+'</div>':'')+
      (pur.SupplierPaymentTerms?'<div><b>Payment terms:</b> '+esc(pur.SupplierPaymentTerms)+'</div>':'');

    if(pur.Notes){
      document.getElementById('pd-notes').innerHTML='<div class="panel" style="margin-bottom:0;"><h3 style="font-size:13px;margin-bottom:6px;">Notes</h3><div style="font-size:12.5px;">'+esc(pur.Notes)+'</div></div>';
    }

    document.getElementById('pd-items').innerHTML='<table><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Unit cost</th><th>Sell price</th><th>Total</th></tr></thead><tbody>'+
      items.map(function(i){
        var detail=[i.Strength,i.DosageForm,i.Unit].filter(Boolean).join(' · ');
        return '<tr><td>'+esc(i.ProductName)+(detail?'<br><span style="color:var(--ink-soft);font-size:11px;">'+esc(detail)+'</span>':'')+'</td>'+
          '<td>'+esc(i.BatchNumber||'—')+'</td>'+
          '<td>'+(i.ExpiryDate?esc(i.ExpiryDate):'<span style="color:var(--ink-soft);">—</span>')+'</td>'+
          '<td>'+i.Quantity+'</td><td>$'+money(i.PurchasePrice)+'</td><td>$'+money(i.SellingPrice)+'</td><td>$'+money(i.Total)+'</td></tr>';
      }).join('')+'</tbody></table>';

    document.getElementById('pd-totals').innerHTML=
      '<div class="panel" style="margin-bottom:0;padding:12px 14px;">'+
      '<div class="cart-total-row"><span>Subtotal</span><span>$'+money(pur.TotalAmount)+'</span></div>'+
      '<div class="cart-total-row"><span>Discount</span><span>−$'+money(pur.Discount)+'</span></div>'+
      '<div class="cart-total-row"><span>Tax</span><span>+$'+money(pur.Tax)+'</span></div>'+
      '<div class="cart-total-row grand"><span>Grand total</span><span>$'+money(pur.GrandTotal)+'</span></div>'+
      '<div class="cart-total-row"><span>Paid</span><span style="color:var(--primary-dark);">$'+money(pur.PaidAmount)+'</span></div>'+
      '<div class="cart-total-row"><span>Balance owed</span><span style="color:'+(Number(pur.Balance)>0?'var(--danger)':'var(--primary-dark)')+';">$'+money(pur.Balance)+'</span></div>'+
      '</div>';

    if(payments.length){
      var payRows=payments.map(function(p){
        return '<tr><td>'+new Date(p.Date).toLocaleDateString()+'</td><td>$'+money(p.Amount)+'</td><td>'+esc(p.Method)+'</td><td>'+esc(p.Reference||'—')+'</td><td>'+esc(p.ReceivedByName||p.ReceivedBy)+'</td></tr>';
      }).join('');
      document.getElementById('pd-payments').innerHTML='<div class="panel" style="margin-bottom:0;padding:0;"><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>'+payRows+'</tbody></table></div>';
    } else {
      document.getElementById('pd-payments').innerHTML='<div class="panel" style="margin-bottom:0;"><div class="empty-state">No payments recorded yet</div></div>';
    }

    var deleteBtn=document.getElementById('purchase-details-delete');
    if(pur.RecordStatus==='Deleted'){
      document.getElementById('pd-deleted-banner').innerHTML='<div class="msg error" style="margin-bottom:14px;"><b>Deleted</b> by '+esc(pur.DeletedByName||pur.DeletedBy)+' on '+new Date(pur.DeletedDate).toLocaleString()+'<br>Reason: '+esc(pur.DeletedReason)+'</div>';
      deleteBtn.style.display='none';
    } else {
      deleteBtn.style.display = (session.roleName==='Owner') ? 'inline-block' : 'none';
    }
  }).catch(function(err){document.getElementById('pd-msg').innerHTML='<div class="msg error">'+err+'</div>';});
}
document.getElementById('purchase-details-close').addEventListener('click',function(){document.getElementById('purchase-details-modal').classList.remove('active');});
document.getElementById('purchase-details-delete').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var purchaseId=document.getElementById('purchase-details-modal').dataset.purchaseId;
  var reason=prompt('Reason for deleting this purchase order?');
  if(!reason||!reason.trim()) return;
  return call('deletePurchase',session.userId,purchaseId,reason.trim()).then(function(res){
    if(!res.success) return toast(res.message,true);
    toast(res.partialReversal ? 'Order deleted. Note: some stock from this order was already sold and could not be reversed.' : 'Order deleted.');
    document.getElementById('purchase-details-modal').classList.remove('active');
    loadPurchases(); loadProducts(); loadSuppliers(true); loadDashboard();
  }).catch(function(err){toast(err,true);});
  });
});
document.getElementById('add-purchase-btn').addEventListener('click',function(){
  document.getElementById('purchase-modal-msg').innerHTML='';
  document.getElementById('purchase-lines').innerHTML='';
  document.getElementById('pu-invoice').value='';
  document.getElementById('pu-discount').value='0';
  document.getElementById('pu-tax').value='0';
  document.getElementById('pu-paid').value='0';
  purchaseLineCount=0;
  addPurchaseLine();
  document.getElementById('purchase-modal').classList.add('active');
});
document.getElementById('purchase-modal-cancel').addEventListener('click',function(){document.getElementById('purchase-modal').classList.remove('active');});
document.getElementById('add-purchase-line').addEventListener('click',addPurchaseLine);
window.activePurchaseLineForNewProduct = null;
function openProductModalForPurchase(btn) {
  window.activePurchaseLineForNewProduct = btn.closest('.line-item-row');
  document.getElementById('product-form').reset();
  editingProductId='';
  document.getElementById('product-modal-title').textContent='Add Product';
  document.getElementById('pd-price-preview').style.display='none';
  document.getElementById('product-modal').classList.add('active');
  document.getElementById('product-modal').style.zIndex = '200';
}
function addPurchaseLine(){
  var idx=purchaseLineCount++;
  var div=document.createElement('div');
  div.className='line-item-row'; div.dataset.idx=idx;
  div.style.marginBottom='8px';
  div.style.border='1px solid var(--line)';
  div.style.padding='8px';
  div.style.borderRadius='8px';
  
  div.innerHTML=
    '<div class="li-top" style="display:flex;gap:10px;margin-bottom:8px;align-items:center;">'+
      '<input type="text" class="pl-product-search" list="products-datalist" placeholder="Search product..." style="flex:1;">'+
      '<input type="hidden" class="pl-product-id">'+
      '<button type="button" class="btn outline small add-product-shortcut" onclick="openProductModalForPurchase(this)" style="padding:0 8px;font-size:12px;">+ New</button>'+
      '<button type="button" class="li-remove" onclick="this.closest(\'.line-item-row\').remove();recalcPurchaseTotals();">✕</button>'+
    '</div>'+
    '<div class="li-product-info" style="font-size:11.5px;color:var(--primary);margin-bottom:8px;font-weight:600;"></div>'+
    '<div class="li-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;align-items:center;">'+
      '<div class="pl-qty-wrapper">'+
        '<input class="pl-qty" type="number" min="0" placeholder="Qty">'+
      '</div>'+
      '<input class="pl-cost" type="number" min="0" placeholder="Purchase price">'+
      '<input class="pl-price" type="number" min="0" placeholder="Selling price">'+
      '<input class="pl-expiry" type="text" placeholder="Expiry YYYY-MM-DD">'+
    '</div>'+
    '<div class="pl-line-total" style="text-align:right;font-size:12px;color:var(--ink-soft);margin-top:4px;">Line total: <b>$0.00</b></div>';
  document.getElementById('purchase-lines').appendChild(div);
  recalcPurchaseTotals();
}
function recalcPurchaseTotals(){
  var subtotal=0;
  document.querySelectorAll('#purchase-lines .line-item-row').forEach(function(rowEl){
    var id = rowEl.querySelector('.pl-product-id').value;
    var qty=Number(rowEl.querySelector('.pl-qty').value)||0;
    var pillsEl = rowEl.querySelector('.pl-pills');
    var pills = pillsEl ? (Number(pillsEl.value)||0) : 0;
    
    var effectiveQty = qty;
    if (pills > 0 && id) {
      var p = allProducts.find(function(item){ return item.ProductID === id; });
      if(p && p.PillsPerUnit > 0) {
        effectiveQty = qty + (pills / p.PillsPerUnit);
      }
    }
    
    var cost=Number(rowEl.querySelector('.pl-cost').value)||0;
    var lineTotal=effectiveQty*cost;
    subtotal+=lineTotal;
    var totalEl=rowEl.querySelector('.pl-line-total b');
    if(totalEl) totalEl.textContent='$'+money(lineTotal);
  });
  var discount=Number(document.getElementById('pu-discount').value)||0;
  var tax=Number(document.getElementById('pu-tax').value)||0;
  var grandTotal=Math.max(0, subtotal-discount+tax);
  document.getElementById('pu-calc-subtotal').textContent='$'+money(subtotal);
  document.getElementById('pu-calc-discount').textContent='$'+money(discount);
  document.getElementById('pu-calc-tax').textContent='$'+money(tax);
  document.getElementById('pu-calc-grandtotal').textContent='$'+money(grandTotal);
}
document.getElementById('purchase-lines').addEventListener('input', function(e){
  if(e.target.classList.contains('pl-product-search')){
    var row = e.target.closest('.line-item-row');
    var val = e.target.value.trim().toLowerCase();
    var p = allProducts.find(function(item){ return item.ProductName.toLowerCase() === val; });
    var idInput = row.querySelector('.pl-product-id');
    var info = row.querySelector('.li-product-info');
    var qtyWrap = row.querySelector('.pl-qty-wrapper');
    if(p) {
      idInput.value = p.ProductID;
      row.querySelector('.pl-cost').value = p.PurchasePrice || '';
      row.querySelector('.pl-price').value = p.SellingPrice || '';
      if(p.SellByPill) {
        info.textContent = 'Pill product: ' + p.PillsPerUnit + ' pills/unit';
        qtyWrap.innerHTML = '<div style="display:flex;gap:4px;align-items:center;">'+
          '<input class="pl-qty" type="number" min="0" placeholder="Units" style="width:70px;padding:4px;">'+
          '<span style="font-size:11px;color:var(--ink-soft);">+</span>'+
          '<input class="pl-pills" type="number" min="0" placeholder="Pills" style="width:70px;padding:4px;">'+
          '</div>';
      } else {
        info.textContent = 'Standard product';
        qtyWrap.innerHTML = '<input class="pl-qty" type="number" min="0" placeholder="Qty">';
      }
      recalcPurchaseTotals();
    } else {
      idInput.value = '';
      info.textContent = '';
      qtyWrap.innerHTML = '<input class="pl-qty" type="number" min="0" placeholder="Qty">';
    }
  }
  if(e.target.classList.contains('pl-qty')||e.target.classList.contains('pl-cost')||e.target.classList.contains('pl-pills')) recalcPurchaseTotals();
});
document.getElementById('pu-discount').addEventListener('input', recalcPurchaseTotals);
document.getElementById('pu-tax').addEventListener('input', recalcPurchaseTotals);
document.getElementById('purchase-modal-save').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('purchase-modal-msg');
  var supplierId=document.getElementById('pu-supplier').value;
  if(!supplierId){msgEl.innerHTML='<div class="msg error">Select a supplier.</div>';return;}
  var items=[];
  document.querySelectorAll('#purchase-lines .line-item-row').forEach(function(row){
    var id=row.querySelector('.pl-product-id').value;
    if(!id) return;
    var qty=Number(row.querySelector('.pl-qty').value)||0;
    var pillsEl = row.querySelector('.pl-pills');
    var pills = pillsEl ? (Number(pillsEl.value)||0) : 0;
    
    var effectiveQty = qty;
    if (pills > 0) {
      var p = allProducts.find(function(item){ return item.ProductID === id; });
      if(p && p.PillsPerUnit > 0) {
        effectiveQty = qty + (pills / p.PillsPerUnit);
      }
    }
    
    if(effectiveQty>0){
      items.push({
        productId:id, quantity:effectiveQty,
        purchasePrice:Number(row.querySelector('.pl-cost').value)||0,
        sellingPrice:Number(row.querySelector('.pl-price').value)||0,
        expiryDate:row.querySelector('.pl-expiry').value.trim()
      });
    }
  });
  if(!items.length){msgEl.innerHTML='<div class="msg error">Add at least one line item with a quantity.</div>';return;}
  var payload={
    supplierId:supplierId, invoiceNumber:document.getElementById('pu-invoice').value.trim(), items:items,
    discount:Number(document.getElementById('pu-discount').value)||0, tax:Number(document.getElementById('pu-tax').value)||0,
    paidAmount:Number(document.getElementById('pu-paid').value)||0
  };
  return call('createPurchase',session.userId,payload).then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('purchase-modal').classList.remove('active');
    toast('Purchase '+res.purchaseId+' recorded — $'+money(res.grandTotal));
    loadPurchases(); loadProducts(); loadSuppliers(true); loadDashboard();
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});

// ── Sales history + returns ───────────────────────────────────────────────
function loadSalesHistory(){
  call('getSales',session.userId,100).then(function(res){
    var tbody=document.getElementById('sales-tbody');
    if(!res.success){tbody.innerHTML='<tr><td colspan="6"><div class="empty-state">'+res.message+'</div></td></tr>';return;}
    if(!res.sales.length){tbody.innerHTML='<tr><td colspan="6"><div class="empty-state">No sales yet</div></td></tr>';return;}
    tbody.innerHTML=res.sales.map(function(s){
      return '<tr><td>'+s.SaleID+'</td><td>'+new Date(s.SaleDate).toLocaleString()+'</td><td>'+esc(s.CashierName)+'</td>'+
        '<td>'+esc(s.PaymentMethod)+'</td><td>$'+money(s.GrandTotal)+'</td>'+
        '<td class="row-actions"><button onclick="openSaleDetails(\''+s.SaleID+'\')">View</button></td></tr>';
    }).join('');
  }).catch(function(err){toast(err,true);});
}
function openSaleDetails(saleId){
  currentSaleDetailsId=saleId;
  document.getElementById('sd-sale-id').textContent=saleId;
  document.getElementById('sd-msg').innerHTML='';
  document.getElementById('sale-details-modal').classList.add('active');
  call('getSaleDetails',session.userId,saleId).then(function(res){
    var el=document.getElementById('sd-items');
    if(!res.success){el.innerHTML='<div class="empty-state">'+res.message+'</div>';return;}
    el.innerHTML='<table><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th>'+(can('PERM_REFUND')?'<th></th>':'')+'</tr></thead><tbody>'+
      res.items.map(function(i){
        var returnBtn=can('PERM_REFUND')?'<button onclick="promptReturn(\''+saleId+'\',\''+i.ProductID+'\',\''+esc(i.ProductName)+'\','+i.Quantity+')">Return</button>':'';
        return '<tr><td>'+esc(i.ProductName)+'</td><td>'+i.Quantity+'</td><td>$'+money(i.UnitPrice)+'</td><td>$'+money(i.Total)+'</td><td class="row-actions">'+returnBtn+'</td></tr>';
      }).join('')+'</tbody></table>';
  });
}
document.getElementById('sale-details-close').addEventListener('click',function(){document.getElementById('sale-details-modal').classList.remove('active');});
document.getElementById('sale-details-print').addEventListener('click',function(){ if(currentSaleDetailsId) printReceipt(currentSaleDetailsId); });
function promptReturn(saleId,productId,productName,maxQty){
  var qty=prompt('Return how many units of "'+productName+'"? (max '+maxQty+')','1');
  if(!qty) return;
  var reason=prompt('Reason? (e.g. Wrong Item, Customer Changed Mind, Damaged, Expired)','Customer Changed Mind');
  if(!reason) return;
  call('createReturn',session.userId,saleId,productId,Number(qty),reason).then(function(res){
    if(!res.success) return toast(res.message,true);
    toast('Refund of $'+money(res.refundAmount)+' recorded.');
    document.getElementById('sale-details-modal').classList.remove('active');
    loadProducts(); loadDashboard();
  }).catch(function(err){toast(err,true);});
}

// ── Finance tabs ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(function(tab){
  tab.addEventListener('click',function(){
    document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
    tab.classList.add('active');
    document.querySelectorAll('.finance-tab').forEach(function(el){el.style.display='none';});
    document.getElementById('finance-'+tab.getAttribute('data-tab')).style.display='block';
  });
});
function loadExpenses(){
  call('getExpenses',session.userId,100).then(function(res){
    var tbody=document.getElementById('expenses-tbody');
    if(!res.success){tbody.innerHTML='<tr><td colspan="5"><div class="empty-state">'+res.message+'</div></td></tr>';return;}
    if(!res.expenses.length){tbody.innerHTML='<tr><td colspan="5"><div class="empty-state">No expenses yet</div></td></tr>';return;}
    tbody.innerHTML=res.expenses.map(function(e){
      return '<tr><td>'+new Date(e.ExpenseDate).toLocaleDateString()+'</td><td>'+esc(e.Category)+'</td><td>'+esc(e.Description||'—')+'</td><td>$'+money(e.Amount)+'</td><td>'+esc(e.PaymentMethod)+'</td></tr>';
    }).join('');
  });
}
function loadIncome(){
  call('getIncome',session.userId,100).then(function(res){
    var tbody=document.getElementById('income-tbody');
    if(!res.success){tbody.innerHTML='<tr><td colspan="4"><div class="empty-state">'+res.message+'</div></td></tr>';return;}
    if(!res.income.length){tbody.innerHTML='<tr><td colspan="4"><div class="empty-state">No income entries yet</div></td></tr>';return;}
    tbody.innerHTML=res.income.map(function(i){
      return '<tr><td>'+new Date(i.Date).toLocaleDateString()+'</td><td>'+esc(i.Source)+'</td><td>'+esc(i.Description||'—')+'</td><td>$'+money(i.Amount)+'</td></tr>';
    }).join('');
  });
}
function loadPayments(){
  call('getPayments',session.userId,100).then(function(res){
    var tbody=document.getElementById('payments-tbody');
    if(!res.success){tbody.innerHTML='<tr><td colspan="4"><div class="empty-state">'+res.message+'</div></td></tr>';return;}
    if(!res.payments.length){tbody.innerHTML='<tr><td colspan="4"><div class="empty-state">No payments recorded yet</div></td></tr>';return;}
    var nameById={}; allSuppliers.forEach(function(s){nameById[s.SupplierID]=s.SupplierName;});
    tbody.innerHTML=res.payments.map(function(p){
      return '<tr><td>'+new Date(p.Date).toLocaleDateString()+'</td><td>'+esc(nameById[p.SupplierID]||p.SupplierID)+'</td><td>$'+money(p.Amount)+'</td><td>'+esc(p.Method)+'</td></tr>';
    }).join('');
  });
}
document.getElementById('add-expense-btn').addEventListener('click',function(){
  document.getElementById('expense-modal-msg').innerHTML='';
  document.getElementById('ef-category').value=''; document.getElementById('ef-description').value=''; document.getElementById('ef-amount').value='';
  document.getElementById('expense-modal').classList.add('active');
});
document.getElementById('expense-modal-cancel').addEventListener('click',function(){document.getElementById('expense-modal').classList.remove('active');});
document.getElementById('expense-modal-save').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('expense-modal-msg');
  var payload={category:document.getElementById('ef-category').value.trim(),description:document.getElementById('ef-description').value.trim(),
    amount:document.getElementById('ef-amount').value, paymentMethod:document.getElementById('ef-method').value};
  if(!payload.category||!payload.amount){msgEl.innerHTML='<div class="msg error">Category and amount are required.</div>';return;}
  return call('createExpense',session.userId,payload).then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('expense-modal').classList.remove('active');
    toast('Expense recorded.'); loadExpenses(); loadDashboard();
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});
document.getElementById('add-income-btn').addEventListener('click',function(){
  document.getElementById('income-modal-msg').innerHTML='';
  document.getElementById('if-source').value=''; document.getElementById('if-description').value=''; document.getElementById('if-amount').value='';
  document.getElementById('income-modal').classList.add('active');
});
document.getElementById('income-modal-cancel').addEventListener('click',function(){document.getElementById('income-modal').classList.remove('active');});
document.getElementById('income-modal-save').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('income-modal-msg');
  var payload={source:document.getElementById('if-source').value.trim(),description:document.getElementById('if-description').value.trim(),amount:document.getElementById('if-amount').value};
  if(!payload.source||!payload.amount){msgEl.innerHTML='<div class="msg error">Source and amount are required.</div>';return;}
  return call('createIncome',session.userId,payload).then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('income-modal').classList.remove('active');
    toast('Income recorded.'); loadIncome();
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});
document.getElementById('add-payment-btn').addEventListener('click',function(){
  document.getElementById('payment-modal-msg').innerHTML='';
  document.getElementById('pf-pay-amount').value=''; document.getElementById('pf-pay-reference').value='';
  loadPurchases(); // ensure allPurchases is fresh before populating the order dropdown
  refreshPayableOrders();
  document.getElementById('payment-modal').classList.add('active');
});
function refreshPayableOrders(){
  var supplierId=document.getElementById('pf-pay-supplier').value;
  var sel=document.getElementById('pf-pay-purchase');
  var payable=allPurchases.filter(function(p){ return p.SupplierID===supplierId && p.RecordStatus!=='Deleted' && Number(p.Balance)>0.01; });
  sel.innerHTML='<option value="">General payment — not tied to a specific order</option>'+
    payable.map(function(p){ return '<option value="'+p.PurchaseID+'" data-balance="'+p.Balance+'">'+p.PurchaseID+' — owes $'+money(p.Balance)+'</option>'; }).join('');
}
document.getElementById('pf-pay-supplier').addEventListener('change', refreshPayableOrders);
document.getElementById('pf-pay-purchase').addEventListener('change', function(){
  var opt=this.options[this.selectedIndex];
  var balance=opt.getAttribute('data-balance');
  document.getElementById('pf-pay-amount').value = balance ? balance : '';
});
document.getElementById('payment-modal-cancel').addEventListener('click',function(){document.getElementById('payment-modal').classList.remove('active');});
document.getElementById('payment-modal-save').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('payment-modal-msg');
  var payload={supplierId:document.getElementById('pf-pay-supplier').value,
    purchaseId:document.getElementById('pf-pay-purchase').value,
    amount:document.getElementById('pf-pay-amount').value,
    method:document.getElementById('pf-pay-method').value, reference:document.getElementById('pf-pay-reference').value.trim()};
  if(!payload.supplierId||!payload.amount){msgEl.innerHTML='<div class="msg error">Supplier and amount are required.</div>';return;}
  return call('createPayment',session.userId,payload).then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('payment-modal').classList.remove('active');
    toast('Payment recorded.'); loadPayments(); loadSuppliers(true); loadPurchases();
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});

// ── Cash Drawer ────────────────────────────────────────────────────────────
function loadDrawer(){
  call('getCurrentDrawer',session.userId).then(function(res){
    var el=document.getElementById('drawer-panel');
    if(!res.success){el.innerHTML='<div class="empty-state">'+res.message+'</div>';return;}
    if(!res.drawer){
      el.innerHTML=
        '<h3>No shift in progress</h3>'+
        '<p class="panel-note" style="margin-bottom:12px;">Count the cash in the till and enter it below, then start your shift. Every cash, card, and mobile money sale you ring up will be tracked automatically until you end the shift.</p>'+
        '<div class="field" style="max-width:260px;"><label>Opening cash balance</label><input type="text" id="drawer-opening" value="0"></div>'+
        '<button class="btn small" id="start-shift-btn">Start Shift</button>'+
        '<div id="drawer-msg"></div>';
      document.getElementById('start-shift-btn').addEventListener('click',function(){
        var self=this;
        runGuarded(self, function(){
          var msgEl=document.getElementById('drawer-msg');
          return call('startShift',session.userId,document.getElementById('drawer-opening').value).then(function(r){
            if(!r.success){ msgEl.innerHTML='<div class="msg error">'+r.message+'</div>'; return; }
            toast('Shift started.'); loadDrawer();
          }).catch(function(err){ msgEl.innerHTML='<div class="msg error">'+err+'</div>'; });
        });
      });
    } else {
      var d=res.drawer;
      var total=Number(d.CashSales)+Number(d.CardSales)+Number(d.MobileMoney);
      el.innerHTML=
        '<h3>Shift in progress</h3>'+
        '<p class="panel-note" style="margin-bottom:12px;">Started '+new Date(d.OpenedAt||d.Date).toLocaleString()+'</p>'+
        '<div class="cards" style="margin-bottom:16px;">'+
        '<div class="card"><div class="label">Opening balance</div><div class="value">$'+money(d.OpeningBalance)+'</div></div>'+
        '<div class="card"><div class="label">Cash sales</div><div class="value">$'+money(d.CashSales)+'</div></div>'+
        '<div class="card"><div class="label">Card sales</div><div class="value">$'+money(d.CardSales)+'</div></div>'+
        '<div class="card"><div class="label">Mobile money</div><div class="value">$'+money(d.MobileMoney)+'</div></div>'+
        '<div class="card"><div class="label">Total sales this shift</div><div class="value">$'+money(total)+'</div></div>'+
        '</div>'+
        '<p class="panel-note" style="margin-bottom:8px;">When you\'re ready to end your shift, count the cash in the till and enter it below — this will also record everything you sold during the shift.</p>'+
        '<div class="field" style="max-width:260px;"><label>Counted cash</label><input type="text" id="drawer-closing" value="0"></div>'+
        '<button class="btn small" id="end-shift-btn">End Shift</button>'+
        '<div id="drawer-msg"></div>'+
        '<div id="shift-summary-result"></div>';
      document.getElementById('end-shift-btn').addEventListener('click',function(){
        var self=this;
        runGuarded(self, function(){
          var msgEl=document.getElementById('drawer-msg');
          return call('endShift',session.userId,document.getElementById('drawer-closing').value).then(function(r){
            if(!r.success){ msgEl.innerHTML='<div class="msg error">'+r.message+'</div>'; return; }
            renderShiftEndSummary(r);
            loadDashboard();
          }).catch(function(err){ msgEl.innerHTML='<div class="msg error">'+err+'</div>'; });
        });
      });
    }
  }).catch(function(err){toast(err,true);});

  if(can('PERM_VIEW_REPORTS')){
    document.getElementById('shift-history-panel').style.display='block';
    loadShiftHistory();
  } else {
    document.getElementById('shift-history-panel').style.display='none';
  }
}
function renderShiftEndSummary(r){
  var el=document.getElementById('shift-summary-result');
  var diffColor = r.difference===0 ? 'var(--primary-dark)' : (r.difference<0 ? 'var(--danger)' : 'var(--warn)');
  var itemsHtml = r.itemsSold.length
    ? '<table><thead><tr><th>Product</th><th>Qty sold</th><th>Revenue</th></tr></thead><tbody>'+
        r.itemsSold.map(function(i){ return '<tr><td>'+esc(i.productName)+'</td><td>'+i.qty+'</td><td>$'+money(i.revenue)+'</td></tr>'; }).join('')+
      '</tbody></table>'
    : '<div class="empty-state">No sales were rung up during this shift.</div>';
  el.innerHTML =
    '<div class="panel" style="background:var(--primary-tint);margin-top:14px;">'+
      '<h3>Shift ended — '+r.transactionCount+' transaction'+(r.transactionCount===1?'':'s')+'</h3>'+
      '<div class="cart-total-row"><span>Expected cash</span><span>$'+money(r.expected)+'</span></div>'+
      '<div class="cart-total-row"><span>Counted cash</span><span>$'+money(r.counted)+'</span></div>'+
      '<div class="cart-total-row grand" style="color:'+diffColor+';"><span>Difference</span><span>$'+money(r.difference)+'</span></div>'+
      '<h3 style="margin-top:16px;">Items sold this shift</h3>'+
      itemsHtml+
      '<button class="btn small secondary" style="margin-top:12px;" onclick="loadDrawer()">Start a new shift</button>'+
    '</div>';
}

// ── Shift History (admin) ───────────────────────────────────────────────
function loadShiftHistory(){
  call('getShiftHistory',session.userId,50).then(function(res){
    var tbody=document.getElementById('shift-history-tbody');
    if(!res.success){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state">'+res.message+'</div></td></tr>';return;}
    if(!res.shifts.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state">No completed shifts yet</div></td></tr>';return;}
    tbody.innerHTML=res.shifts.map(function(s){
      var diffColor = Number(s.Difference)===0 ? 'ok' : 'low';
      return '<tr><td>'+s.Date+'</td><td>'+esc(s.CashierName)+'</td><td>'+new Date(s.OpenedAt||s.Date).toLocaleTimeString()+'</td>'+
        '<td>'+(s.ClosedAt?new Date(s.ClosedAt).toLocaleTimeString():'—')+'</td>'+
        '<td>$'+money(Number(s.OpeningBalance)+Number(s.CashSales)-Number(s.Expenses))+'</td>'+
        '<td>$'+money(s.ClosingBalance)+'</td>'+
        '<td><span class="pill '+diffColor+'">$'+money(s.Difference)+'</span></td>'+
        '<td class="row-actions"><button onclick="openShiftDetails(\''+s.DrawerID+'\')">View</button></td></tr>';
    }).join('');
  }).catch(function(err){toast(err,true);});
}
function openShiftDetails(drawerId){
  document.getElementById('shd-drawer-id').textContent=drawerId;
  document.getElementById('shd-msg').innerHTML='';
  document.getElementById('shd-meta').innerHTML='';
  document.getElementById('shd-items').innerHTML='';
  document.getElementById('shift-details-modal').classList.add('active');
  call('getShiftDetails',session.userId,drawerId).then(function(res){
    if(!res.success){document.getElementById('shd-msg').innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    var d=res.drawer;
    document.getElementById('shd-meta').innerHTML=
      'Cashier: <b>'+esc(d.CashierName)+'</b> &nbsp;·&nbsp; '+new Date(d.OpenedAt||d.Date).toLocaleString()+' to '+(d.ClosedAt?new Date(d.ClosedAt).toLocaleString():'—')+
      '<br>Opening: $'+money(d.OpeningBalance)+' &nbsp;·&nbsp; Counted: $'+money(d.ClosingBalance)+' &nbsp;·&nbsp; Difference: $'+money(d.Difference);
    var el=document.getElementById('shd-items');
    if(!res.items.length){ el.innerHTML='<div class="empty-state">No sales during this shift.</div>'; return; }
    el.innerHTML='<table><thead><tr><th>Product</th><th>Qty sold</th><th>Revenue</th></tr></thead><tbody>'+
      res.items.map(function(i){ return '<tr><td>'+esc(i.ProductName)+'</td><td>'+i.QuantitySold+'</td><td>$'+money(i.Revenue)+'</td></tr>'; }).join('')+
      '</tbody></table>';
  }).catch(function(err){document.getElementById('shd-msg').innerHTML='<div class="msg error">'+err+'</div>';});
}
document.getElementById('shift-details-close').addEventListener('click',function(){document.getElementById('shift-details-modal').classList.remove('active');});

// ── Users ──────────────────────────────────────────────────────────────────
function loadUsers(){
  call('getUsers',session.userId).then(function(res){
    if(!res.success){document.getElementById('users-tbody').innerHTML='<tr><td colspan="6"><div class="empty-state">'+res.message+'</div></td></tr>';return;}
    allRoles=res.roles;
    document.getElementById('uf-role').innerHTML=allRoles.map(function(r){return '<option value="'+r.RoleID+'">'+esc(r.RoleName)+'</option>';}).join('');
    var tbody=document.getElementById('users-tbody');
    if(!res.users.length){tbody.innerHTML='<tr><td colspan="6"><div class="empty-state">No users yet</div></td></tr>';return;}
    tbody.innerHTML=res.users.map(function(u){
      var active=u.Active!==false&&u.Active!=='FALSE';
      return '<tr><td>'+esc(u.FullName)+'</td><td>'+esc(u.Username)+'</td><td>'+esc(u.RoleName)+'</td>'+
        '<td><span class="pill '+(active?'ok':'bad')+'">'+(active?'Active':'Disabled')+'</span></td><td>'+(u.LastLogin?new Date(u.LastLogin).toLocaleString():'—')+'</td>'+
        '<td class="row-actions"><button onclick="toggleUser(\''+u.UserID+'\','+(!active)+')">'+(active?'Disable':'Enable')+'</button>'+
        '<button onclick="resetPassword(\''+u.UserID+'\')">Reset password</button></td></tr>';
    }).join('');
  }).catch(function(err){toast(err,true);});
}
function toggleUser(userId,setActive){
  call('setUserActive',session.userId,userId,setActive).then(function(res){
    if(!res.success) return toast(res.message,true);
    toast('Updated.'); loadUsers();
  }).catch(function(err){toast(err,true);});
}
function resetPassword(userId){
  var pw=prompt('New password (min 4 characters):');
  if(!pw) return;
  call('resetUserPassword',session.userId,userId,pw).then(function(res){
    if(!res.success) return toast(res.message,true);
    toast('Password reset.');
  }).catch(function(err){toast(err,true);});
}
document.getElementById('add-user-btn').addEventListener('click',function(){
  document.getElementById('user-modal-msg').innerHTML='';
  document.getElementById('uf-name').value=''; document.getElementById('uf-username').value=''; document.getElementById('uf-password').value='';
  document.getElementById('user-modal').classList.add('active');
});
document.getElementById('user-modal-cancel').addEventListener('click',function(){document.getElementById('user-modal').classList.remove('active');});
document.getElementById('user-modal-save').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var msgEl=document.getElementById('user-modal-msg');
  var payload={fullName:document.getElementById('uf-name').value.trim(),username:document.getElementById('uf-username').value.trim(),
    password:document.getElementById('uf-password').value, roleId:document.getElementById('uf-role').value};
  if(!payload.fullName||!payload.username||!payload.password){msgEl.innerHTML='<div class="msg error">All fields are required.</div>';return;}
  return call('createUser',session.userId,payload).then(function(res){
    if(!res.success){msgEl.innerHTML='<div class="msg error">'+res.message+'</div>';return;}
    document.getElementById('user-modal').classList.remove('active');
    toast('User created.'); loadUsers();
  }).catch(function(err){msgEl.innerHTML='<div class="msg error">'+err+'</div>';});
  });
});

// ── Settings ───────────────────────────────────────────────────────────────
function loadSettings(){
  call('getSettings',session.userId).then(function(res){
    if(!res.success) return toast(res.message,true);
    var s=res.settings, b=res.business;
    document.getElementById('bi-name').value=b.BusinessName||'';
    document.getElementById('bi-owner').value=b.Owner||'';
    document.getElementById('bi-license').value=b.LicenseNumber||'';
    document.getElementById('bi-tax').value=b.TaxID||'';
    document.getElementById('bi-phone').value=b.Phone||'';
    document.getElementById('bi-email').value=b.Email||'';
    document.getElementById('bi-website').value=b.Website||'';
    document.getElementById('bi-socialhandle').value=b.SocialHandle||'';
    document.getElementById('bi-socialphone').value=b.SocialPhone||'';
    document.getElementById('bi-language').value=b.Language||'';
    document.getElementById('bi-address').value=b.Address||'';
    document.getElementById('s-currency').value=s.Currency||'';
    document.getElementById('s-vat').value=s.VATRate||'';
    document.getElementById('s-lowstock').value=s.LowStockAlertThreshold||'';
    document.getElementById('s-expirydays').value=s.ExpiryAlertDays||'';
    document.getElementById('s-receiptheader').value=s.ReceiptHeader||'';
    document.getElementById('s-receiptfooter').value=s.ReceiptFooter||'';
  }).catch(function(err){toast(err,true);});
}
document.getElementById('save-business-btn').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var payload={BusinessName:document.getElementById('bi-name').value.trim(),Owner:document.getElementById('bi-owner').value.trim(),
    LicenseNumber:document.getElementById('bi-license').value.trim(),TaxID:document.getElementById('bi-tax').value.trim(),
    Phone:document.getElementById('bi-phone').value.trim(),Email:document.getElementById('bi-email').value.trim(),
    Website:document.getElementById('bi-website').value.trim(),SocialHandle:document.getElementById('bi-socialhandle').value.trim(),
    SocialPhone:document.getElementById('bi-socialphone').value.trim(),Language:document.getElementById('bi-language').value.trim(),
    Address:document.getElementById('bi-address').value.trim(),LogoURL:''};
  return call('updateBusinessInfo',session.userId,payload).then(function(res){
    if(!res.success) return toast(res.message,true);
    toast('Business info saved.');
  }).catch(function(err){toast(err,true);});
  });
});
document.getElementById('save-settings-btn').addEventListener('click',function(){
  var self=this;
  runGuarded(self, function(){
  var payload={Currency:document.getElementById('s-currency').value.trim(),VATRate:document.getElementById('s-vat').value.trim(),
    LowStockAlertThreshold:document.getElementById('s-lowstock').value.trim(),ExpiryAlertDays:document.getElementById('s-expirydays').value.trim(),
    ReceiptHeader:document.getElementById('s-receiptheader').value.trim(),ReceiptFooter:document.getElementById('s-receiptfooter').value.trim()};
  return call('updateSettings',session.userId,payload).then(function(res){
    if(!res.success) return toast(res.message,true);
    toast('Settings saved.');
  }).catch(function(err){toast(err,true);});
  });
});

// ── Receipt printing ─────────────────────────────────────────────────────
function ensureSettingsLoaded(){
  if(cachedSettings) return Promise.resolve();
  return call('getSettings',session.userId).then(function(res){
    if(res.success){ cachedSettings=res.settings; cachedBusiness=res.business; }
  }).catch(function(){});
}
function printReceipt(saleId){
  Promise.all([ensureSettingsLoaded(), call('getSaleDetails',session.userId,saleId)]).then(function(results){
    var res=results[1];
    if(!res.success){ toast(res.message,true); return; }
    renderReceiptHtml(res.sale, res.items);
    setTimeout(function(){ window.print(); }, 60);
  }).catch(function(err){ toast(err,true); });
}
function renderReceiptHtml(sale, items){
  var b=cachedBusiness||{}, s=cachedSettings||{};
  var currency=s.Currency||'';
  var rows=items.map(function(i){
    return '<tr><td colspan="2">'+esc(i.ProductName)+'</td></tr>'+
      '<tr><td>'+i.Quantity+' x '+money(i.UnitPrice)+'</td><td class="r">'+currency+' '+money(i.Total)+'</td></tr>';
  }).join('');
  document.getElementById('receipt-print-area').innerHTML=
    '<div class="receipt">'+
      (s.ReceiptHeader?'<div class="center">'+esc(s.ReceiptHeader)+'</div>':'')+
      '<h2>'+esc(b.BusinessName||'Pharmacy')+'</h2>'+
      (b.Address?'<div class="center">'+esc(b.Address)+'</div>':'')+
      (b.Phone?'<div class="center">'+esc(b.Phone)+'</div>':'')+
      '<hr>'+
      '<div>Sale: '+esc(sale.SaleID)+'</div>'+
      '<div>Date: '+new Date(sale.SaleDate).toLocaleString()+'</div>'+
      '<hr>'+
      '<table>'+rows+'</table>'+
      '<hr>'+
      '<table>'+
        '<tr><td>Subtotal</td><td class="r">'+currency+' '+money(sale.TotalAmount)+'</td></tr>'+
        '<tr><td>Discount</td><td class="r">'+currency+' '+money(sale.Discount)+'</td></tr>'+
        '<tr><td>Tax</td><td class="r">'+currency+' '+money(sale.Tax)+'</td></tr>'+
        '<tr><td><b>Total</b></td><td class="r"><b>'+currency+' '+money(sale.GrandTotal)+'</b></td></tr>'+
        '<tr><td>Paid ('+esc(sale.PaymentMethod)+')</td><td class="r">'+currency+' '+money(sale.AmountReceived)+'</td></tr>'+
        '<tr><td>Change</td><td class="r">'+currency+' '+money(sale.ChangeGiven)+'</td></tr>'+
      '</table>'+
      '<hr>'+
      '<div class="center">'+esc(s.ReceiptFooter||'Thank you for your purchase')+'</div>'+
    '</div>';
}
