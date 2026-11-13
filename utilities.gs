// ============================================================================
//  utilities.gs — shared helpers
// ============================================================================

// Sequential, human-readable IDs — never rely on sheet row numbers.
// e.g. nextId('MED', 'Products', 'ProductID') -> "MED000042"
function nextId(prefix, sheetName, idField) {
  var table = readTable(sheetName);
  var max = 0;
  table.rows.forEach(function (r) {
    var raw = String(r[idField] || '');
    var num = parseInt(raw.replace(prefix, ''), 10);
    if (!isNaN(num) && num > max) max = num;
  });
  var next = max + 1;
  var padded = ('000000' + next).slice(-6);
  return prefix + padded;
}

function nowIso() {
  return new Date().toISOString();
}

// Simple salted hash for custom-login passwords. Good enough for a v0 —
// swap for a stronger scheme (bcrypt via a library, or Google SSO) later.
function hashPassword(plain) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plain, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function logAudit(userId, moduleOrAction, actionOrDetails, recordId, oldValue, newValue) {
  try {
    var module = 'General';
    var action = '';
    var recId = '';
    var oldVal = '';
    var newVal = '';
    var ip = '';
    var device = '';

    if (arguments.length <= 5 && typeof recordId === 'string' && (recordId.startsWith('Mozilla') || recordId.indexOf('/') > -1 || recordId === '')) {
      // Called as logAudit(userId, action, details, userAgent, ip)
      action = moduleOrAction || '';
      newVal = actionOrDetails ? (typeof actionOrDetails === 'string' ? actionOrDetails : JSON.stringify(actionOrDetails)) : '';
      device = recordId || '';
      ip = oldValue || '';
    } else if (arguments.length <= 3 && !recordId) {
      // Called as logAudit(userId, action, details)
      action = moduleOrAction || '';
      newVal = actionOrDetails ? (typeof actionOrDetails === 'string' ? actionOrDetails : JSON.stringify(actionOrDetails)) : '';
    } else {
      // Called as logAudit(userId, module, action, recordId, oldValue, newValue)
      module = moduleOrAction || 'General';
      action = actionOrDetails || '';
      recId = recordId || '';
      oldVal = oldValue ? (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)) : '';
      newVal = newValue ? (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)) : '';
    }

    appendRow(SHEETS.AUDIT_LOGS, {
      LogID: Utilities.getUuid(),
      DateTime: nowIso(),
      UserID: userId || '',
      Module: module,
      Action: action,
      RecordID: recId,
      OldValue: oldVal,
      NewValue: newVal,
      IP: ip,
      Device: device
    });
  } catch (e) {
    Logger.log('logAudit failed: ' + e);
  }
}

function getAuditLogs(userId, limit) {
  return safe(function () {
    authorize(userId, PERMISSIONS.VIEW_AUDIT_LOGS);
    var rows = readTable(SHEETS.AUDIT_LOGS).rows;
    var users = readTable(SHEETS.USERS).rows;
    var nameById = {};
    users.forEach(function (u) { nameById[u.UserID] = u.FullName || u.Username; });

    rows.forEach(function (r) {
      r.UserName = nameById[r.UserID] || r.UserID || 'System';
    });

    rows.sort(function (a, b) {
      return new Date(b.DateTime) - new Date(a.DateTime);
    });

    var max = Number(limit) || 200;
    return ok({ logs: rows.slice(0, max) });
  })();
}

function ok(data) {
  var out = { success: true };
  for (var k in data) out[k] = data[k];
  return out;
}

// ── Stock health classification ────────────────────────────────────────────
// Four tiers, mirroring the Asella Organic inventory engine:
//   out_of_stock : qty == 0
//   critical     : 0 < qty <= threshold / 2
//   low          : threshold / 2 < qty <= threshold
//   ok           : qty > threshold
function classifyStock(qty, threshold) {
  var q = Number(qty) || 0;
  var t = Number(threshold) || 0;
  if (q <= 0) return STOCK_HEALTH.OUT_OF_STOCK;
  if (t > 0 && q <= t / 2) return STOCK_HEALTH.CRITICAL;
  if (t > 0 && q <= t) return STOCK_HEALTH.LOW;
  if (t <= 0) return STOCK_HEALTH.OK;
  return STOCK_HEALTH.OK;
}

// ── Date-range helpers ─────────────────────────────────────────────────────
// Parses 'YYYY-MM-DD' (or a full ISO string) as a LOCAL date at 00:00:00.
function parseDateStart(value) {
  if (value === undefined || value === null || value === '') return new Date(0);
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
  }
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value));
  if (!m) return new Date(0);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

// Same, but covering the whole day (23:59:59.999) so a single-day range
// behaves like an inclusive filter.
function parseDateEnd(value) {
  if (value === undefined || value === null || value === '') return new Date();
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
  }
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value));
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

// 'YYYY-MM-DD' for today, in the script's timezone.
function todayIsoDate() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function fail(message, code) {
  var out = { success: false, message: message };
  if (code) out.code = code;
  return out;
}

// Wraps a function body in try/catch. Returns a callable that catches
// exceptions and returns fail() instead of throwing.
// Usage: return safe(function () { ... })();
function safe(fn) {
  return function () {
    try {
      return fn.apply(this, arguments);
    } catch (e) {
      Logger.log('safe() caught: ' + e);
      return fail(e.message || String(e));
    }
  };
}

// ── Client error reporting ──────────────────────────────────────────────────
// Call from client: google.script.run.reportClientError({ message, stack, context, userAgent })
function reportClientError(payload) {
  try {
    var userId = (Session.getActiveUser && Session.getActiveUser().getEmail()) || 'anonymous';
    appendRow(SHEETS.AUDIT_LOGS, {
      LogID: Utilities.getUuid(),
      DateTime: nowIso(),
      UserID: userId,
      Module: 'Client',
      Action: 'CLIENT_ERROR',
      RecordID: '',
      OldValue: '',
      NewValue: JSON.stringify({
        message: payload.message,
        stack: payload.stack,
        context: payload.context,
        userAgent: payload.userAgent,
        url: payload.url
      }),
      IP: '',
      Device: payload.userAgent || ''
    });
  } catch (e) {
    Logger.log('reportClientError failed: ' + e);
  }
  return ok({});
}

// ── Audit log archival ──────────────────────────────────────────────────────
// Moves AuditLogs older than retentionDays to an 'AuditLogs_Archive_YYYY' sheet.
// Run daily via trigger.
function archiveAuditLogs(retentionDays) {
  retentionDays = retentionDays || 90;
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var src = ss.getSheetByName(SHEETS.AUDIT_LOGS);
  if (!src) return ok({ message: 'AuditLogs sheet not found' });

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  var data = src.getDataRange().getValues();
  if (data.length <= 1) return ok({ message: 'No logs to archive', archived: 0 });

  var headers = data[0];
  var rows = data.slice(1);
  var toArchive = [];
  var toKeep = [headers];

  rows.forEach(function (row) {
    var logDate = new Date(row[1]); // DateTime column
    if (logDate < cutoff) {
      toArchive.push(row);
    } else {
      toKeep.push(row);
    }
  });

  if (!toArchive.length) return ok({ message: 'No logs older than ' + retentionDays + ' days', archived: 0 });

  // Target archive sheet name by year of oldest log
  var oldestYear = new Date(toArchive[0][1]).getFullYear();
  var archiveName = 'AuditLogs_Archive_' + oldestYear;
  var archiveSheet = ss.getSheetByName(archiveName);

  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(archiveName);
    archiveSheet.appendRow(headers);
  }

  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, toArchive.length, headers.length).setValues(toArchive);

  // Rewrite source with only kept rows
  src.clearContents();
  if (toKeep.length > 0) {
    src.getRange(1, 1, toKeep.length, headers.length).setValues(toKeep);
  }

  return ok({ message: 'Archived ' + toArchive.length + ' logs to ' + archiveName, archived: toArchive.length });
}

// Setup daily trigger for archival (run once manually)
function setupArchiveTrigger() {
  // Delete existing triggers for this function
  var allTriggers = ScriptApp.getProjectTriggers();
  allTriggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'archiveAuditLogs') ScriptApp.deleteTrigger(t);
  });
  // Create new daily trigger at 2 AM
  ScriptApp.newTrigger('archiveAuditLogs')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();
}
