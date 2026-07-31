import { CONFIG } from "./config.js";

function base64url(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlStr(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "").trim();
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenExpiry - 60) return cachedToken;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: CONFIG.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encHeader = base64urlStr(JSON.stringify(header));
  const encClaim = base64urlStr(JSON.stringify(claim));
  const signingInput = `${encHeader}.${encClaim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(CONFIG.FIREBASE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("Firebase auth failed: " + JSON.stringify(data));

  cachedToken = data.access_token;
  cachedTokenExpiry = now + data.expires_in;
  return cachedToken;
}

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function toFirestoreValue(val) {
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "number") return { integerValue: String(val) };
  if (typeof val === "boolean") return { booleanValue: val };
  return { stringValue: String(val) };
}

function fromFirestoreFields(fields) {
  const out = {};
  for (const key in fields) {
    const v = fields[key];
    if (v.stringValue !== undefined) out[key] = v.stringValue;
    else if (v.integerValue !== undefined) out[key] = parseInt(v.integerValue);
    else if (v.booleanValue !== undefined) out[key] = v.booleanValue;
  }
  return out;
}

export async function setDoc(collection, docId, data) {
  const token = await getAccessToken();
  const fields = {};
  for (const key in data) fields[key] = toFirestoreValue(data[key]);

  const maskParams = Object.keys(data)
    .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");

  await fetch(`${BASE_URL}/${collection}/${docId}?${maskParams}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
}

export async function getDoc(collection, docId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/${collection}/${docId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status !== 200) return null;
  const data = await res.json();
  return fromFirestoreFields(data.fields || {});
}

export async function deleteDoc(collection, docId) {
  const token = await getAccessToken();
  await fetch(`${BASE_URL}/${collection}/${docId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function listDocs(collection) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/${collection}?pageSize=1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(d => {
    const id = d.name.split("/").pop();
    return { id, ...fromFirestoreFields(d.fields || {}) };
  });
  }
