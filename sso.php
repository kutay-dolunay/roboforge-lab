<?php
/**
 * RoboForge SSO endpoint  —  RoboFabrik Akademi (Moodle) → RoboForge
 * -----------------------------------------------------------------------------
 * Purpose: let a student who is logged into Moodle (akademi.robofabrik.tech)
 * open RoboForge (roboforge.robofabrik.tech) already authenticated.
 *
 * Flow:
 *   1. RoboForge sends the student here with ?return=<roboforge url>&nonce=<random>
 *   2. This script bootstraps Moodle. require_login() ensures they are logged in
 *      (Moodle handles the login page + KVKK first-login consent gate itself).
 *   3. We build a small identity token {sub,name,email,role,exp,nonce,iss,aud},
 *      sign it RS256 with the PRIVATE key (kept ONLY on this server, web-inaccessible),
 *      and redirect back to RoboForge:  <return>#sso=<jwt>
 *   4. RoboForge verifies the signature with the PUBLIC key (safe to ship in JS).
 *
 * SECURITY MODEL:
 *   - Private key never leaves this server and is stored OUTSIDE the web root
 *     (see RF_SSO_PRIVATE_KEY_PATH). RoboForge only ever holds the PUBLIC key.
 *   - Token is short-lived (RF_SSO_TTL). RoboForge issues its own long session after.
 *   - `return` URL is validated against an allow-list (no open redirect).
 *   - nonce is echoed back so RoboForge can bind the token to the request it started.
 *   - We DO NOT bypass Moodle login or KVKK — require_login() enforces both.
 *
 * DEPLOY: place under your existing custom code, e.g.
 *     /var/www/akademi/local/roboforge/sso.php     (adjust CFG path below)
 *   and generate keys on the server (see DEPLOY_SSO.md). Do NOT paste secrets
 *   into any chat/doc — generate them with openssl on the VPS.
 * -----------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// 1) CONFIG — adjust these to your server paths/values.
// ---------------------------------------------------------------------------

// Absolute path to Moodle's config.php (bootstraps Moodle + $USER + $CFG).
// Verified on this VPS: nginx root = /var/www/html/moodle (moodle44_old is the inactive 4.4 install).
$RF_MOODLE_CONFIG = '/var/www/html/moodle/config.php';

// Absolute path to the RS256 PRIVATE key — MUST be OUTSIDE the web root so it
// can never be served over HTTP. Generate on the server (see DEPLOY_SSO.md).
$RF_SSO_PRIVATE_KEY_PATH = '/var/rf-secrets/roboforge_sso_private.pem';

// Issuer / audience identifiers (must match what RoboForge expects).
$RF_SSO_ISS = 'akademi.robofabrik.tech';
$RF_SSO_AUD = 'roboforge.robofabrik.tech';

// Token time-to-live in seconds (short — RoboForge mints its own session after).
$RF_SSO_TTL = 120;

// Allow-list of return URLs (prefixes). Prevents open-redirect abuse.
$RF_SSO_ALLOWED_RETURNS = array(
    'https://roboforge.robofabrik.tech/',
    'http://roboforge.robofabrik.tech/',
);

// ---------------------------------------------------------------------------
// 2) Bootstrap Moodle (this enforces login + KVKK consent via require_login()).
// ---------------------------------------------------------------------------
if (!is_readable($RF_MOODLE_CONFIG)) {
    http_response_code(500);
    exit('SSO config error: Moodle config not found.');
}
require($RF_MOODLE_CONFIG);            // defines $CFG, connects DB
require_once($CFG->libdir . '/moodlelib.php');

// Set an explicit page context/URL so require_login() returns the user HERE after
// login, then we bounce them on to RoboForge. Avoids "page URL not set" notices.
$PAGE->set_context(context_system::instance());
$selfquery = 'return=' . rawurlencode(isset($_GET['return']) ? (string)$_GET['return'] : '')
           . '&nonce=' . rawurlencode(isset($_GET['nonce']) ? (string)$_GET['nonce'] : '');
$PAGE->set_url('/local/roboforge/sso.php', array(
    'return' => isset($_GET['return']) ? (string)$_GET['return'] : '',
    'nonce'  => isset($_GET['nonce'])  ? (string)$_GET['nonce']  : '',
));

require_login();                        // Moodle handles login page + first-login KVKK gate
$user = $USER;

// ---------------------------------------------------------------------------
// 3) Validate the return URL (no open redirect).
// ---------------------------------------------------------------------------
$return = isset($_GET['return']) ? (string)$_GET['return'] : '';
$nonce  = isset($_GET['nonce'])  ? preg_replace('/[^A-Za-z0-9_\-]/', '', (string)$_GET['nonce']) : '';

$ok = false;
foreach ($RF_SSO_ALLOWED_RETURNS as $prefix) {
    if (strncmp($return, $prefix, strlen($prefix)) === 0) { $ok = true; break; }
}
if (!$ok) {
    http_response_code(400);
    exit('SSO error: invalid return URL.');
}

// ---------------------------------------------------------------------------
// 4) Determine the user's role (student / teacher / manager / admin).
//    Simple heuristic: site admins => 'admin'; users with an editingteacher/teacher
//    role anywhere => 'teacher'; otherwise 'student'.
// ---------------------------------------------------------------------------
$role = 'student';
if (is_siteadmin($user)) {
    $role = 'admin';
} else {
    // Any teacher-like role assignment across the site?
    $teacherish = $DB->get_records_sql(
        "SELECT ra.id
           FROM {role_assignments} ra
           JOIN {role} r ON r.id = ra.roleid
          WHERE ra.userid = :uid
            AND r.shortname IN ('editingteacher','teacher','manager','coursecreator')",
        array('uid' => $user->id)
    );
    if (!empty($teacherish)) { $role = 'teacher'; }
}

// ---------------------------------------------------------------------------
// 5) Build + RS256-sign the identity token.
// ---------------------------------------------------------------------------
if (!is_readable($RF_SSO_PRIVATE_KEY_PATH)) {
    http_response_code(500);
    exit('SSO error: signing key unavailable.');
}
$privateKey = file_get_contents($RF_SSO_PRIVATE_KEY_PATH);

$now = time();
$payload = array(
    'iss'   => $RF_SSO_ISS,
    'aud'   => $RF_SSO_AUD,
    'iat'   => $now,
    'exp'   => $now + $RF_SSO_TTL,
    'nonce' => $nonce,
    'sub'   => 'rfa-' . (int)$user->id,                    // stable Moodle user id
    'idnumber' => (string)$user->idnumber,                 // RFA-XXXXXX student no (if set)
    'name'  => fullname($user),
    'email' => (string)$user->email,
    'role'  => $role,
);

$jwt = rf_jwt_rs256($payload, $privateKey);
if ($jwt === false) {
    http_response_code(500);
    exit('SSO error: token signing failed.');
}

// ---------------------------------------------------------------------------
// 6) Redirect back to RoboForge with the token in the URL fragment
//    (fragment => never sent to any server, only readable by RoboForge JS).
// ---------------------------------------------------------------------------
// DEBUG: with &debug=1, print the raw token + payload as text instead of redirecting.
if (isset($_GET['debug']) && $_GET['debug'] === '1') {
    header('Content-Type: text/plain; charset=utf-8');
    echo "JWT:\n" . $jwt . "\n\nPAYLOAD:\n" . json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
    exit;
}
$sep = (strpos($return, '#') === false) ? '#' : '&';
header('Location: ' . $return . $sep . 'sso=' . rawurlencode($jwt));
exit;

// ===========================================================================
// Helpers
// ===========================================================================
function rf_b64url($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}
function rf_jwt_rs256($payload, $privateKeyPem) {
    $header = array('alg' => 'RS256', 'typ' => 'JWT');
    $segments = array(
        rf_b64url(json_encode($header, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)),
        rf_b64url(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)),
    );
    $signingInput = implode('.', $segments);
    $signature = '';
    $pkey = openssl_pkey_get_private($privateKeyPem);
    if ($pkey === false) { return false; }
    $ok = openssl_sign($signingInput, $signature, $pkey, OPENSSL_ALGO_SHA256);
    if (function_exists('openssl_pkey_free')) { @openssl_pkey_free($pkey); }
    if (!$ok) { return false; }
    $segments[] = rf_b64url($signature);
    return implode('.', $segments);
}
