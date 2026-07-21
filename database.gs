// ============================================================================
//  database.gs — Database Layer
//  The ONLY file that touches Range objects. Every module reads/writes
//  through these functions, which is what makes swapping Sheets for a real
//  database later a contained change instead of a rewrite.
// ============================================================================

function getDB() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheet(name) {
  var ss = getDB();
  var sheet = ss.getSheetByName(name);
  var headers = HEADERS[name];
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    CacheService.getScriptCache().put('schema-ok:' + name, '1', 21600);
    return sheet;
  }

  // Migration: if HEADERS gained columns since this sheet was created,
  // append the missing ones at the end — existing columns/data are never
  // touched or reordered. This check is only actually run once every few
  // hours per sheet (cached) instead of on every read/write, since doing
  // it on every single sheet access was the main cause of slow page loads.
  var cacheKey = 'schema-ok:' + name;
  if (!CacheService.getScriptCache().get(cacheKey)) {
    var lastCol = sheet.getLastColumn();
    var existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var missing = headers.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
    if (missing.length) {
      sheet.getRange(1, existingHeaders.length + 1, 1, missing.length).setValues([missing]);
    }
    CacheService.getScriptCache().put(cacheKey, '1', 21600);
  }
  return sheet;
}

// Call this once after deploying a schema change (new columns in HEADERS)
// if you don't want to wait up to 6 hours for the cache above to expire.
function clearSchemaCache() {
  Object.keys(SHEETS).forEach(function (key) { CacheService.getScriptCache().remove('schema-ok:' + SHEETS[key]); });
  Logger.log('Schema cache cleared — the next request to each sheet will re-check its columns.');
}

// Reads a whole table into memory ONCE as plain objects.
function readTable(name) {
  var sheet = ensureSheet(name);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = HEADERS[name];
  if (lastRow < 2) return { headers: headers, rows: [] };

  var values = sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, headers.length)).getValues();
  var rows = values
    .map(function (r, i) {
      var obj = {};
      for (var c = 0; c < headers.length; c++) obj[headers[c]] = r[c];
      obj._row = i + 2;
      return obj;
    })
    // skip fully-blank rows (common after manual sheet edits)
    .filter(function (obj) {
      return headers.some(function (h) { return obj[h] !== '' && obj[h] !== null && obj[h] !== undefined; });
    });
  return { headers: headers, rows: rows };
}

function appendRow(name, rowObject) {
  var sheet = ensureSheet(name);
  var headers = HEADERS[name];
  var row = headers.map(function (h) { return rowObject[h] !== undefined ? rowObject[h] : ''; });
  sheet.appendRow(row);
  return row;
}

function appendRows(name, rowObjects) {
  if (!rowObjects.length) return;
  var sheet = ensureSheet(name);
  var headers = HEADERS[name];
  var rows = rowObjects.map(function (rowObject) {
    return headers.map(function (h) { return rowObject[h] !== undefined ? rowObject[h] : ''; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function findRowById(name, idField, idValue) {
  var table = readTable(name);
  for (var i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i][idField]) === String(idValue)) return table.rows[i];
  }
  return null;
}

function findRows(name, predicate) {
  return readTable(name).rows.filter(predicate);
}

function updateRowById(name, idField, idValue, updates) {
  var sheet = ensureSheet(name);
  var headers = HEADERS[name];
  var row = findRowById(name, idField, idValue);
  if (!row) return false;
  for (var key in updates) {
    var colIndex = headers.indexOf(key);
    if (colIndex > -1) sheet.getRange(row._row, colIndex + 1).setValue(updates[key]);
  }
  return true;
}

function upsertRow(name, idField, idValue, rowObject) {
  var existing = findRowById(name, idField, idValue);
  if (existing) {
    updateRowById(name, idField, idValue, rowObject);
    return false; // updated
  }
  appendRow(name, rowObject);
  return true; // inserted
}

function deleteRowById(name, idField, idValue) {
  var row = findRowById(name, idField, idValue);
  if (!row) return false;
  ensureSheet(name).deleteRow(row._row);
  return true;
}
