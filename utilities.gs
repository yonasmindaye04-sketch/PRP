// ============================================================================
//  utilities.gs — shared helpers
// ============================================================================

function nextId(prefix, sheetName, idField) {
  var table = readTable(sheetName);
  var max = 0;
  table.rows.forEach(function (r) {
    var raw = String(r[idField] || '');
    var num = parseInt(raw.replace(prefix, ''), 10);
    if (!isNaN(num) && num > max) max = num;
  });
  var padded = ('000000' + (max + 1)).slice(-6);
  return prefix + padded;
}

function nowIso() { return new Date().toISOString(); }
function today() { return new Date().toDateString(); }

function hashPassword(plain) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plain, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function logAudit(userId, module, action, recordId, oldValue, newValue) {
  try {
    appendRow(SHEETS.AUDIT_LOGS, {
      LogID: Utilities.getUuid(),
      DateTime: nowIso(),
      UserID: userId,
      Module: module,
      Action: action,
      RecordID: recordId || '',
      OldValue: oldValue !== undefined ? JSON.stringify(oldValue) : '',
      NewValue: newValue !== undefined ? JSON.stringify(newValue) : '',
      IP: '',
      Device: ''
    });
  } catch (e) { Logger.log('logAudit failed: ' + e); }
}

function logActivity(userId, activity) {
  try {
    var now = new Date();
    appendRow(SHEETS.ACTIVITY_LOG, {
      ActivityID: Utilities.getUuid(),
      UserID: userId,
      Activity: activity,
      Date: now.toDateString(),
      Time: now.toTimeString()
    });
  } catch (e) { Logger.log('logActivity failed: ' + e); }
}

function ok(data) {
  var out = { success: true };
  for (var k in data) out[k] = data[k];
  return out;
}

function fail(message) {
  return { success: false, message: message };
}

// Wraps a handler so every backend entry point returns {success:false,message}
// instead of throwing — google.script.run's failure handler only gets a
// generic error, so we never want an uncaught exception on the server side.
function safe(fn) {
  return function () {
    try {
      return fn.apply(null, arguments);
    } catch (e) {
      Logger.log(e);
      return fail(e.message || String(e));
    }
  };
}
