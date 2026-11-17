/**
 * Ki jön ma? – ntfy közvetítő (Google Apps Script)
 * A Render szerver ide küldi az értesítést, a script pedig a Google szerveréről továbbítja az ntfy.sh-nak.
 * Script properties (Projektbeállítások -> Szkripttulajdonságok):
 *   RELAY_SECRET = hosszú véletlen szöveg (ugyanaz, mint a Renderben az NTFY_RELAY_SECRET)
 *   NTFY_TOKEN   = tk_... (ntfy access token, opcionális)
 */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, status: 400, error: 'bad json' }); }
  var secret = props.getProperty('RELAY_SECRET') || '';
  if (!secret || req.secret !== secret) return out_({ ok: false, status: 403, error: 'forbidden' });
  var msg = req.message || {};
  if (!/^ugyelet-[0-9a-f]{24}$/.test(String(msg.topic || ''))) return out_({ ok: false, status: 400, error: 'bad topic' });
  var headers = {};
  var token = (props.getProperty('NTFY_TOKEN') || '').replace(/\s+/g, '');
  if (token) headers.Authorization = 'Bearer ' + token;
  try {
    var res = UrlFetchApp.fetch('https://ntfy.sh/', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(msg),
      headers: headers, muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    return out_({ ok: code >= 200 && code < 300, status: code, body: res.getContentText().slice(0, 200) });
  } catch (err) {
    return out_({ ok: false, status: 502, error: String(err).slice(0, 200) });
  }
}

function doGet() { return out_({ ok: true, relay: 'macskawc' }); }

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Futtasd egyszer a szerkesztőből: engedélyt kér, és kipróbálja az ntfy-t. */
function tesztKuldes() {
  var token = (PropertiesService.getScriptProperties().getProperty('NTFY_TOKEN') || '').replace(/\s+/g, '');
  var res = UrlFetchApp.fetch('https://ntfy.sh/v1/account', {
    headers: token ? { Authorization: 'Bearer ' + token } : {}, muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
}
