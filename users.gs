// ============================================================================
//  users.gs — user management (create/list/disable staff logins)
// ============================================================================

function createUser(actingUserId, input) {
  return safe(function () {
  authorize(actingUserId, PERMISSIONS.MANAGE_USERS);
  if (!input.username || !input.password || !input.fullName || !input.roleId) {
    return fail('All fields are required.');
  }
  if (findRows(SHEETS.USERS, function (u) { return u.Username === input.username; })[0]) {
    return fail('That username is already taken.');
  }
  if (!findRowById(SHEETS.ROLES, 'RoleID', input.roleId)) return fail('Unknown role.');

  var id = nextId('USR', SHEETS.USERS, 'UserID');
  appendRow(SHEETS.USERS, {
    UserID: id, FullName: input.fullName, Username: input.username,
    PasswordHash: hashPassword(input.password), RoleID: input.roleId,
    Phone: input.phone || '', Email: input.email || '', Active: true,
    LastLogin: '', CreatedDate: nowIso()
  });
  logAudit(actingUserId, 'Users', 'CREATE', id, null, input.username);
  return ok({ userId: id });
  })();
}

function getUsers(userId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_USERS);
  var roles = readTable(SHEETS.ROLES).rows;
  var roleName = {};
  roles.forEach(function (r) { roleName[r.RoleID] = r.RoleName; });
  var users = readTable(SHEETS.USERS).rows.map(function (u) {
    return {
      UserID: u.UserID, FullName: u.FullName, Username: u.Username, RoleID: u.RoleID,
      RoleName: roleName[u.RoleID] || u.RoleID, Active: u.Active, LastLogin: u.LastLogin
    };
  });
  return ok({ users: users, roles: roles });
  })();
}

function setUserActive(actingUserId, targetUserId, active) {
  return safe(function () {
  authorize(actingUserId, PERMISSIONS.MANAGE_USERS);
  if (targetUserId === actingUserId) return fail("You can't disable your own account.");
  updateRowById(SHEETS.USERS, 'UserID', targetUserId, { Active: active });
  logAudit(actingUserId, 'Users', active ? 'ENABLE' : 'DISABLE', targetUserId);
  return ok({});
  })();
}

function resetUserPassword(actingUserId, targetUserId, newPassword) {
  return safe(function () {
  authorize(actingUserId, PERMISSIONS.MANAGE_USERS);
  if (!newPassword || newPassword.length < 4) return fail('Password must be at least 4 characters.');
  updateRowById(SHEETS.USERS, 'UserID', targetUserId, { PasswordHash: hashPassword(newPassword) });
  logAudit(actingUserId, 'Users', 'RESET_PASSWORD', targetUserId);
  return ok({});
  })();
}