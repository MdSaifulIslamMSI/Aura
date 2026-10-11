/*
 * AURA Marketplace — authenticated ZAP session bootstrap (GraalJS).
 *
 * Runs inside the OWASP ZAP container as the context's script-based
 * authentication method. AURA's SPA authenticates with Firebase, so this
 * script replays the same exchange the storefront performs:
 *
 *   1. Password sign-in against the Firebase Identity Toolkit REST API to
 *      obtain a short-lived ID token.
 *   2. Exchange that token for an AURA browser session via POST /api/auth/sync
 *      (the same endpoint the frontend calls after Firebase login).
 *
 * ZAP then drives the spider/active-scan jobs as the seeded smoke user.
 *
 * Configuration comes exclusively from environment variables and the plan's
 * authentication parameters — no credentials are stored in this repository:
 *   - ZAP_AUTH_TARGET           origin of the deployment under test (staging or preview)
 *   - ZAP_AUTH_USERNAME         seeded smoke-account email (SMOKE_USER_EMAIL)
 *   - ZAP_AUTH_PASSWORD         seeded smoke-account password
 *   - ZAP_AUTH_SYNC_PATH        session-establishing route, default /api/auth/sync
 * Plan parameters (see zap-auth-plan.yaml):
 *   - firebaseApiKey            public Firebase Web API key for the target project
 */

const HttpRequestHeader = Java.type("org.parosproxy.paros.network.HttpRequestHeader");
const HttpHeader = Java.type("org.parosproxy.paros.network.HttpHeader");
const URI = Java.type("org.apache.commons.httpclient.URI");
const AuthenticationHelper = Java.type("org.zaproxy.zap.authentication.AuthenticationHelper");

const FIREBASE_SIGN_IN_PATH = "/v1/accounts:signInWithPassword";
const FIREBASE_ORIGIN = "https://identitytoolkit.googleapis.com";

function readEnv(name) {
  var System = Java.type("java.lang.System");
  var value = System.getenv(name);
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function jsonBody(message) {
  try {
    return JSON.parse(message.getResponseBody().toString());
  } catch (error) {
    return null;
  }
}

function sendJson(helper, message, method, uri, body, headers) {
  message.setRequestHeader(new HttpRequestHeader(method, uri, HttpHeader.HTTP11));
  if (body !== null && body !== undefined) {
    message.setRequestBody(body);
  }
  var header = message.getRequestHeader();
  header.setHeader(HttpHeader.CONTENT_TYPE, "application/json");
  if (headers) {
    for (var index = 0; index < headers.length; index += 1) {
      header.setHeader(headers[index].name, headers[index].value);
    }
  }
  header.setContentLength(message.getRequestBody().length());
  helper.sendAndReceive(message, false);
  return message;
}

function authenticate(helper, paramsValues, credentials) {
  var firebaseApiKey = paramsValues.get("firebaseApiKey");
  var syncPath = paramsValues.get("syncPath");
  if (!syncPath) {
    syncPath = "/api/auth/sync";
  }

  var target = readEnv("ZAP_AUTH_TARGET").replace(/\/+$/, "");
  var username = String(credentials.getParam("username") || "").trim();
  var password = String(credentials.getParam("password") || "");

  if (!firebaseApiKey) {
    print("[aura-auth] firebaseApiKey plan parameter is unset; cannot sign in.");
    return null;
  }
  if (!target) {
    print("[aura-auth] ZAP_AUTH_TARGET environment variable is unset; cannot sign in.");
    return null;
  }
  if (!username || !password) {
    print("[aura-auth] Seeded credentials are missing; run the staging smoke-account bootstrap first.");
    return null;
  }

  // 1. Firebase password sign-in -> ID token.
  var signInUri = new URI(FIREBASE_ORIGIN + FIREBASE_SIGN_IN_PATH + "?key=" + firebaseApiKey, true);
  var signInMessage = helper.prepareMessage();
  sendJson(
    helper,
    signInMessage,
    HttpRequestHeader.POST,
    signInUri,
    JSON.stringify({ email: username, password: password, returnSecureToken: true }),
    null
  );

  var signInStatus = signInMessage.getResponseHeader().getStatusCode();
  if (signInStatus !== 200) {
    var signInBody = jsonBody(signInMessage);
    var reason = signInBody && signInBody.error ? String(signInBody.error.message) : "";
    print("[aura-auth] Firebase sign-in rejected the seeded user (HTTP " + signInStatus
      + (reason ? ", " + reason : "") + ").");
    return null;
  }
  var signIn = jsonBody(signInMessage);
  var idToken = signIn ? String(signIn.idToken || "") : "";
  if (!idToken) {
    print("[aura-auth] Firebase sign-in response contained no idToken.");
    return null;
  }
  AuthenticationHelper.addAuthMessageToHistory(signInMessage);

  // 2. Exchange the ID token for an AURA session. The session cookie lands in
  //    the ZAP HTTP state; the Authorization header is carried as well so the
  //    API's bearer-authenticated surfaces are covered.
  var syncUri = new URI(target + syncPath, true);
  var syncMessage = helper.prepareMessage();
  sendJson(
    helper,
    syncMessage,
    HttpRequestHeader.POST,
    syncUri,
    JSON.stringify({ email: username }),
    [{ name: "Authorization", value: "Bearer " + idToken }]
  );

  var syncStatus = syncMessage.getResponseHeader().getStatusCode();
  if (syncStatus !== 200) {
    var preview = String(syncMessage.getResponseBody() || "").substring(0, 200);
    print("[aura-auth] " + syncPath + " rejected the session exchange (HTTP " + syncStatus + "): " + preview);
    return null;
  }
  var syncBody = jsonBody(syncMessage);
  var status = syncBody ? String(syncBody.status || "") : "";
  if (status !== "authenticated") {
    print("[aura-auth] Session status is '" + status + "'. MFA, trusted-device, or login-assurance "
      + "challenges are required beyond this seeded smoke account; scan cannot run authenticated.");
    return null;
  }

  print("[aura-auth] Authenticated session established for the seeded smoke user (status=" + status + ").");
  AuthenticationHelper.addAuthMessageToHistory(syncMessage);
  return syncMessage;
}

function getRequiredParamsNames() {
  return ["firebaseApiKey"];
}

function getOptionalParamsNames() {
  return ["syncPath"];
}

function getCredentialsParamsNames() {
  return ["username", "password"];
}
