// ============================================================================
//  auth.gs — authentication & data-driven permissions
//  Roles/Permissions/RolePermissions live in the sheet, not in code, and are
//  cached in CacheService so a permission check doesn't cost a sheet read.
// ============================================================================

function login(username, password) {
  return safe(function () {
    if (!username || !password) return fail('Enter your username and password.');
    var user = findRows(SHEETS.USERS, function (u) { return u.Username === username; })[0];
    if (!user) return fail('Invalid username or password.');
    if (user.Active === false || user.Active === 'FALSE') return fail('This account is disabled.');
    if (user.PasswordHash !== hashPassword(password)) return fail('Invalid username or password.');

    updateRowById(SHEETS.USERS, 'UserID', user.UserID, { LastLogin: nowIso() });
    logActivity(user.UserID, 'Logged in');

    var role = findRowById(SHEETS.ROLES, 'RoleID', user.RoleID);
    return ok({
      userId: user.UserID,
      name: user.FullName,
      roleId: user.RoleID,
      roleName: role ? role.RoleName : user.RoleID,
      permissions: getPermissionsForRole(user.RoleID)
    });
  })();
}

// Re-derives the user from the sheet on every privileged call — a client
// can send whatever it wants, only what's in the Users sheet matters.
function requireUser(userId) {
  var user = findRowById(SHEETS.USERS, 'UserID', userId);
  if (!user) throw new Error('Session expired. Please log in again.');
  if (user.Active === false || user.Active === 'FALSE') throw new Error('This account has been disabled.');
  return user;
}

// RoleID -> [PermissionID, ...], cached for CACHE_TTL_SECONDS.
function getRolePermissionsMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('rolePermissionsMap');
  if (cached) return JSON.parse(cached);

  var map = {};
  readTable(SHEETS.ROLE_PERMISSIONS).rows.forEach(function (rp) {
    if (!map[rp.RoleID]) map[rp.RoleID] = [];
    map[rp.RoleID].push(rp.PermissionID);
  });
  cache.put('rolePermissionsMap', JSON.stringify(map), CACHE_TTL_SECONDS);
  return map;
}

function getPermissionsForRole(roleId) {
  return getRolePermissionsMap()[roleId] || [];
}

// Call after editing RolePermissions programmatically so the change is
// visible immediately instead of waiting for the cache to expire.
function clearPermissionCache() {
  CacheService.getScriptCache().remove('rolePermissionsMap');
}

function hasPermission(roleId, permissionId) {
  return getPermissionsForRole(roleId).indexOf(permissionId) > -1;
}

// Call at the top of every backend function that changes or reveals data.
// Returns the user row on success; throws (caught by safe()) on failure.
function authorize(userId, permissionId) {
  var user = requireUser(userId);
  if (!hasPermission(user.RoleID, permissionId)) {
    throw new Error('You do not have permission to do that (' + permissionId + ').');
  }
  return user;
}
