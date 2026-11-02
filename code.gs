// ============================================================================
//  Code.gs — Web app entry point
// ============================================================================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/*initial admin account to create we need to run this function only once*/

function tempCreateAdmin() {
  appendRow(SHEETS.USERS, {
    UserID: 'USR000001',
    FullName: 'Owner',
    Username: 'admin',
    PasswordHash: hashPassword('ChangeMe123'),
    RoleID: ROLE_IDS.OWNER,
    Phone: '', Email: '', Active: true, LastLogin: '', CreatedDate: nowIso()
  });
  Logger.log('Admin created.');

}



function debugHtml() {
  try {
    var out = HtmlService.createHtmlOutputFromFile('Index');
    Logger.log('Length: ' + out.getContent().length);
  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log('Stack: ' + e.stack);
  }
}