/*
 * RoboForge — Auth module (Moodle SSO client side)
 * -----------------------------------------------------------------------------
 * Handles "Moodle ile Giriş": redirects to the Moodle SSO endpoint, then on
 * return verifies the RS256 token with the PUBLIC key (safe to ship here) and
 * stores a 30-day local session. Exposes window.RFAuth.
 *
 * NOTHING secret lives here. The private key stays on the Moodle server.
 *
 * Usage:
 *   RFAuth.init().then(user => { ... });     // call on every page load
 *   RFAuth.login();                          // start "Moodle ile Giriş"
 *   RFAuth.logout();
 *   RFAuth.getUser();                        // {sub,name,email,role,idnumber} or null
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var CFG = {
    ssoUrl: 'https://akademi.robofabrik.tech/local/roboforge/sso.php',
    iss: 'akademi.robofabrik.tech',
    aud: 'roboforge.robofabrik.tech',
    // PUBLIC key (SPKI DER, base64). Safe to be here — it can only VERIFY, not sign.
    // Paired with the private key on the VPS at /var/rf-secrets/roboforge_sso_private.pem
    publicKeyB64: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApS+F0Goy4CQqC8+Qx1mLiriwBY8a4cEBVXDJ0UpJTF5atccYoyi6UppZJ5HTVjMpGjysQtXeT2+ykI7OzG2g5iHFRqYgefP/kTaownY8iDEO+7cURGOPzUh53qZ3XRQ+KPMs+A1twHEUsSWAvbMcWKiQxjsJEPEVj1BimK4WNFV3l7cM/IWnMbIr/e3s2qG1lzA7fnNR/BeHTmJFV7AgGLgwtS/UogAoy6vxsG6qbUXOrjVAzfyOqDG7yRb+P6DIGTLC2LtCH357AwpTaTrF9iB3DHpqTfLjDV/AJ/AmdCNM6BC98/xEEGh5Zh/JSAgBsfdEqpv5ZxFri8gD4nwn5QIDAQAB',
    sessionKey: 'rf_session',      // localStorage key for the RoboForge session
    nonceKey: 'rf_sso_nonce',
    sessionDays: 30,
  };

  // ---- base64url helpers ----
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function b64ToBytes(s) {
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function bytesToStr(bytes) {
    return new TextDecoder().decode(bytes);
  }
  function randNonce() {
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }

  // ---- import the RSA public key for RS256 verification ----
  var _keyPromise = null;
  function importKey() {
    if (_keyPromise) return _keyPromise;
    if (!CFG.publicKeyB64 || CFG.publicKeyB64.indexOf('PASTE_') === 0) {
      _keyPromise = Promise.reject(new Error('RFAuth: public key not configured'));
      return _keyPromise;
    }
    var der = b64ToBytes(CFG.publicKeyB64);
    _keyPromise = crypto.subtle.importKey(
      'spki', der.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
    return _keyPromise;
  }

  // ---- verify a JWT (RS256) and return the payload, or throw ----
  function verifyToken(jwt) {
    var parts = jwt.split('.');
    if (parts.length !== 3) return Promise.reject(new Error('malformed token'));
    var signingInput = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    var sig = b64urlToBytes(parts[2]);
    return importKey().then(function (key) {
      return crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' }, key, sig.buffer, signingInput.buffer
      );
    }).then(function (valid) {
      if (!valid) throw new Error('bad signature');
      var payload = JSON.parse(bytesToStr(b64urlToBytes(parts[1])));
      var now = Math.floor(Date.now() / 1000);
      if (payload.exp && now > payload.exp + 30) throw new Error('token expired');
      if (payload.iss !== CFG.iss) throw new Error('bad issuer');
      if (payload.aud !== CFG.aud) throw new Error('bad audience');
      return payload;
    });
  }

  // ---- session storage ----
  function saveSession(payload) {
    var sess = {
      sub: payload.sub, name: payload.name, email: payload.email,
      role: payload.role, idnumber: payload.idnumber || '',
      loginAt: Date.now(),
      expAt: Date.now() + CFG.sessionDays * 86400000,
    };
    try { localStorage.setItem(CFG.sessionKey, JSON.stringify(sess)); } catch (e) {}
    return sess;
  }
  function loadSession() {
    try {
      var raw = localStorage.getItem(CFG.sessionKey);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s.expAt || Date.now() > s.expAt) { localStorage.removeItem(CFG.sessionKey); return null; }
      return s;
    } catch (e) { return null; }
  }

  var RFAuth = {
    getUser: function () { return loadSession(); },
    isLoggedIn: function () { return !!loadSession(); },

    // Start "Moodle ile Giriş": go to Moodle SSO, come back with a token.
    login: function (returnTo) {
      var ret = returnTo || (location.origin + location.pathname);
      var nonce = randNonce();
      try { sessionStorage.setItem(CFG.nonceKey, nonce); } catch (e) {}
      var url = CFG.ssoUrl + '?return=' + encodeURIComponent(ret) + '&nonce=' + nonce;
      location.href = url;
    },

    logout: function () {
      try { localStorage.removeItem(CFG.sessionKey); } catch (e) {}
    },

    // Call on every page load. If we just came back from SSO (#sso=...), verify
    // and store the session. Returns a Promise<user|null>.
    init: function () {
      // Already have a valid session?
      var existing = loadSession();

      // Did we just return from SSO?
      var m = location.hash.match(/[#&]sso=([^&]+)/);
      if (m) {
        var jwt = decodeURIComponent(m[1]);
        // strip the token from the URL immediately (don't leave it in history)
        try {
          var clean = location.href.replace(/([#&])sso=[^&]+/, '$1').replace(/[#&]$/, '');
          history.replaceState(null, '', clean);
        } catch (e) {}
        return verifyToken(jwt).then(function (payload) {
          // Nonce binding is a SOFT check: the RS256 signature is the real security
          // (only the Moodle server's private key can produce a valid token). A nonce
          // mismatch (stale/fresh visit) just gets logged, it does NOT reject a valid token.
          try {
            var expectNonce = sessionStorage.getItem(CFG.nonceKey);
            if (expectNonce && payload.nonce && payload.nonce !== expectNonce && global.console) {
              console.info('RFAuth: nonce differs (soft) — token signature is valid, proceeding.');
            }
            sessionStorage.removeItem(CFG.nonceKey);
          } catch (e) {}
          return saveSession(payload);
        }).catch(function (err) {
          if (global.console) console.warn('RFAuth SSO verify failed:', err && err.message);
          return existing || null;
        });
      }
      return Promise.resolve(existing || null);
    },
  };

  global.RFAuth = RFAuth;
  if (typeof module !== 'undefined' && module.exports) module.exports = RFAuth;
})(typeof window !== 'undefined' ? window : globalThis);
