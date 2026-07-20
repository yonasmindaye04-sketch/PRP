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

function logAudit(userId, action, details) {
  try {
    appendRow(SHEETS.AUDIT_LOGS, {
      LogID: Utilities.getUuid(),
      DateTime: nowIso(),
      UserID: userId,
      Action: action,
      Details: typeof details === 'string' ? details : JSON.stringify(details)
    });
  } catch (e) {
    Logger.log('logAudit failed: ' + e);
  }
}

function ok(data) {
  var out = { success: true };
  for (var k in data) out[k] = data[k];
  return out;
}

function fail(message) {
  return { success: false, message: message };
}
