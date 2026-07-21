// ============================================================================
//  returns.gs — Sale returns / refunds
//  Restocks the returned quantity (unless marked Damaged/Expired, in which
//  case it's logged but not put back into sellable stock) and records the
//  refund amount for reconciliation against the cash drawer.
// ============================================================================

// reason: 'Customer Changed Mind' | 'Wrong Item' | 'Damaged' | 'Expired' | ...
function createReturn(userId, saleId, productId, qty, reason) {
  return safe(function () {
  var user = authorize(userId, PERMISSIONS.REFUND);
  var sale = findRowById(SHEETS.SALES, 'SaleID', saleId);
  if (!sale) return fail('Original sale not found.');
  var saleItem = findRows(SHEETS.SALE_ITEMS, function (i) { return i.SaleID === saleId && i.ProductID === productId; })[0];
  if (!saleItem) return fail('That product was not part of this sale.');

  var returnQty = Number(qty);
  if (returnQty <= 0 || returnQty > Number(saleItem.Quantity)) return fail('Invalid return quantity.');

  var product = findRowById(SHEETS.PRODUCTS, 'ProductID', productId);
  var refundAmount = round2(Number(saleItem.UnitPrice) * returnQty);
  var isResalable = reason !== 'Damaged' && reason !== 'Expired';

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (isResalable) {
      // Put it back as its own batch so expiry tracking on the return isn't lost.
      receiveBatch(productId, returnQty, Number(product.PurchasePrice) || 0, Number(product.SellingPrice) || 0, '', '', 'Return', saleId, userId, 'Customer return');
    } else {
      // Log the movement without adding sellable stock back.
      appendRow(SHEETS.STOCK_MOVEMENTS, {
        MovementID: Utilities.getUuid(), Date: nowIso(), ProductID: productId, BatchID: saleItem.BatchID,
        Type: reason, Quantity: 0, PreviousStock: '', NewStock: '', ReferenceType: 'Return', ReferenceID: saleId,
        Remarks: 'Returned but not resalable (' + reason + ')', UserID: userId
      });
    }

    var returnId = nextId('RET', SHEETS.RETURNS, 'ReturnID');
    appendRow(SHEETS.RETURNS, {
      ReturnID: returnId, Date: nowIso(), SaleID: saleId, ProductID: productId,
      Quantity: returnQty, Reason: reason, Amount: refundAmount, ApprovedBy: userId
    });

    bumpOpenDrawer(sale.CashierID, sale.PaymentMethod === 'Cash' ? 'CashSales' : (sale.PaymentMethod === 'Card' ? 'CardSales' : 'MobileMoney'), -refundAmount);

    logAudit(userId, 'Returns', 'CREATE', returnId, null, refundAmount);
    return ok({ returnId: returnId, refundAmount: refundAmount });
  } finally {
    lock.releaseLock();
  }
  })();
}

function getReturns(userId, limit) {
  return safe(function () {
  authorize(userId, PERMISSIONS.REFUND);
  var rows = readTable(SHEETS.RETURNS).rows;
  rows.sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); });
  if (limit) rows = rows.slice(0, limit);
  return ok({ returns: rows });
  })();
}
