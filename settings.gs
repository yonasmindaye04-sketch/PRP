// ============================================================================
//  settings.gs — Settings (key/value) & BusinessInfo, cached
// ============================================================================

function getSettingsMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('settingsMap');
  if (cached) return JSON.parse(cached);
  var map = {};
  readTable(SHEETS.SETTINGS).rows.forEach(function (r) { map[r.Setting] = r.Value; });
  cache.put('settingsMap', JSON.stringify(map), CACHE_TTL_SECONDS);
  return map;
}

function getSettings(userId) {
  return safe(function () {
  requireUser(userId);
  var business = readTable(SHEETS.BUSINESS_INFO).rows[0] || {};
  return ok({ settings: getSettingsMap(), business: business });
  })();
}

function updateSettings(userId, settingsObj) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_SETTINGS);
  Object.keys(settingsObj).forEach(function (key) {
    upsertRow(SHEETS.SETTINGS, 'Setting', key, { Setting: key, Value: settingsObj[key] });
  });
  CacheService.getScriptCache().remove('settingsMap');
  logAudit(userId, 'Settings', 'UPDATE');
  return ok({});
  })();
}

function updateBusinessInfo(userId, info) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_SETTINGS);
  var sheet = ensureSheet(SHEETS.BUSINESS_INFO);
  var headers = HEADERS[SHEETS.BUSINESS_INFO];
  var row = headers.map(function (h) { return info[h] !== undefined ? info[h] : ''; });
  if (sheet.getLastRow() < 2) sheet.appendRow(row);
  else sheet.getRange(2, 1, 1, headers.length).setValues([row]);
  logAudit(userId, 'BusinessInfo', 'UPDATE');
  return ok({});
  })();
}