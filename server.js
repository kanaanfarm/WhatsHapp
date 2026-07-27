require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const crypto = require("crypto");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const { Readable } = require("stream");
const { Document, Packer, Paragraph, HeadingLevel } = require("docx");
const { rateLimit } = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { Server } = require("socket.io");
const webpush = require("web-push");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const APP_BUILD = "6787";
const ROOT = __dirname;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || "connectchat-files";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = String(process.env.SESSION_SECRET || "");
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
const PASSWORD_MIN_LENGTH = 6;
const BCRYPT_ROUNDS = 12;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const SIGNED_URL_SECONDS = 15 * 60;
const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CALLS_ENABLED = process.env.CALLS_ENABLED !== "false";
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const PUSH_SUBJECT = String(process.env.PUSH_SUBJECT || "mailto:admin@connectchat.local").trim();
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  try { webpush.setVapidDetails(PUSH_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); }
  catch (error) { console.error("Push notification setup failed:", error.message); }
}

const AI_PROVIDER = String(process.env.AI_PROVIDER || "openai").trim().toLowerCase();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
const DEEPSEEK_API_KEY = String(process.env.DEEPSEEK_API_KEY || "").trim();
const DEEPSEEK_MODEL = String(process.env.DEEPSEEK_MODEL || "deepseek-v4-flash").trim();
const DEEPSEEK_BASE_URL = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").trim().replace(/\/$/, "");
const OLLAMA_URL = String(process.env.OLLAMA_URL || (AI_PROVIDER === "ollama" ? "http://127.0.0.1:11434" : "")).trim().replace(/\/$/, "");
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || "qwen2.5:7b").trim();
const AI_DEFAULT_PROVIDER_RAW = String(process.env.AI_DEFAULT_PROVIDER || "ollama").trim().toLowerCase();
const AI_DEFAULT_PROVIDER = ["openai", "deepseek", "ollama"].includes(AI_DEFAULT_PROVIDER_RAW) ? AI_DEFAULT_PROVIDER_RAW : "ollama";
const AI_REQUEST_TIMEOUT_MS = Math.min(Math.max(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 60000, 10000), 180000);
const AI_AUTO_FALLBACK_TIMEOUT_MS = Math.min(Math.max(Number(process.env.AI_AUTO_FALLBACK_TIMEOUT_MS) || 12000, 5000), 30000);
const OPENAI_CONFIGURED = Boolean(OPENAI_API_KEY && OPENAI_MODEL);
const DEEPSEEK_CONFIGURED = Boolean(DEEPSEEK_API_KEY && DEEPSEEK_MODEL);
const OLLAMA_CONFIGURED = Boolean(OLLAMA_URL && OLLAMA_MODEL && !/example\.com|replace-me|your-secured/i.test(OLLAMA_URL));
const AI_CONFIGURED = AI_PROVIDER === "hybrid"
  ? OPENAI_CONFIGURED || DEEPSEEK_CONFIGURED || OLLAMA_CONFIGURED
  : AI_PROVIDER === "ollama" ? OLLAMA_CONFIGURED : AI_PROVIDER === "deepseek" ? DEEPSEEK_CONFIGURED : OPENAI_CONFIGURED;
const AI_ENABLED = process.env.AI_ENABLED !== "false" && AI_CONFIGURED;
const AI_SYSTEM_PROMPT = String(process.env.AI_SYSTEM_PROMPT || "You are ConnectChat AI, a helpful, accurate assistant. Reply in the same language as the user unless asked otherwise. Be especially helpful with MEP, HVAC, construction correspondence, calculations, translation, and general questions. Clearly state uncertainty and never invent project facts.").slice(0, 4000);
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PRODUCTION,
  path: "/"
};

const missingEnvironmentVariables = [];
if (!SUPABASE_URL) missingEnvironmentVariables.push("SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) missingEnvironmentVariables.push("SUPABASE_SERVICE_ROLE_KEY");

if (missingEnvironmentVariables.length) {
  console.error(`Missing required .env value(s): ${missingEnvironmentVariables.join(", ")}`);
  console.error("Open the .env file in the same folder as server.js and enter the real Supabase project URL and service_role key.");
  process.exit(1);
}

if (SUPABASE_URL.includes("YOUR_PROJECT") || SUPABASE_SERVICE_ROLE_KEY.includes("YOUR_SERVICE_ROLE_KEY")) {
  console.error("The .env file still contains Supabase placeholder values. Replace them with the real project URL and service_role key.");
  process.exit(1);
}
if (IS_PRODUCTION && (SESSION_SECRET.length < 32 || SESSION_SECRET.includes("change-me") || SESSION_SECRET.includes("replace-with"))) {
  console.error("SESSION_SECRET must be a unique random value of at least 32 characters in production.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const supabaseOrigin = new URL(SUPABASE_URL).origin;

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
}

function originAllowed(origin, req) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (PUBLIC_ORIGIN && parsed.origin === PUBLIC_ORIGIN) return true;
    return parsed.host.toLowerCase() === requestHost(req);
  } catch {
    return false;
  }
}

const io = new Server(server, {
  maxHttpBufferSize: 256 * 1024,
  perMessageDeflate: false,
  allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin, req))
});

const allowedMimeTypes = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "audio/webm", "video/webm", "video/mp4", "video/quicktime", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav",
  "application/pdf", "text/plain", "text/csv", "application/vnd.ms-excel",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
];

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "no-referrer" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'", "wss:", ...(IS_PRODUCTION ? [] : ["ws:"])],
      fontSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", supabaseOrigin],
      mediaSrc: ["'self'", "blob:", supabaseOrigin],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null
    }
  }
}));
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "64kb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "32kb", parameterLimit: 20 }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait and try again." }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts. Please wait 15 minutes and try again." }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." }
});
const recoveryLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many recovery attempts. Please wait 30 minutes and try again." }
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Upload limit reached. Please try again later." }
});
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "AI message limit reached. Please wait one minute." }
});
const statusLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Status posting limit reached. Please try again later." }
});
app.use("/api", apiLimiter);
app.use("/api/login", loginLimiter);
app.use("/api/register", registerLimiter);
app.use("/api/recover", recoveryLimiter);
app.use("/api/upload", uploadLimiter);

function requireAppRequest(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-connectchat-request") !== "1" || !originAllowed(req.get("origin"), req)) {
    return res.status(403).json({ error: "Request was rejected for security reasons." });
  }
  next();
}
app.use("/api", requireAppRequest);

// This endpoint intentionally runs before express-session. It lets the client
// remove a cookie created by an older release even when that stored session can
// no longer be read by the current session store.
app.post("/api/session-reset", (req, res) => {
  res.clearCookie("connectchat.sid", SESSION_COOKIE_OPTIONS);
  res.json({ ok: true });
});

function storedSessionId(sid) {
  return crypto.createHash("sha256").update(String(sid)).digest("hex");
}

class SupabaseSessionStore extends session.Store {
  constructor(client) {
    super();
    this.client = client;
  }

  get(sid, callback) {
    this.client.from("app_sessions").select("sess,expires_at").eq("sid", storedSessionId(sid)).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("Could not read saved session; starting a clean session:", error.message);
          return callback(null, null);
        }
        if (!data) return callback(null, null);
        if (new Date(data.expires_at).getTime() <= Date.now()) {
          return this.destroy(sid, destroyError => callback(destroyError || null, null));
        }
        callback(null, data.sess || null);
      }).catch(error => {
        console.error("Could not read saved session; starting a clean session:", error.message);
        callback(null, null);
      });
  }

  set(sid, sess, callback = () => {}) {
    const expiresAt = sess.cookie?.expires
      ? new Date(sess.cookie.expires).toISOString()
      : new Date(Date.now() + SESSION_MAX_AGE).toISOString();
    this.client.from("app_sessions").upsert({
      sid: storedSessionId(sid),
      sess,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }).then(({ error }) => callback(error || null)).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.client.from("app_sessions").delete().eq("sid", storedSessionId(sid))
      .then(({ error }) => callback(error || null)).catch(callback);
  }

  touch(sid, sess, callback = () => {}) {
    this.set(sid, sess, callback);
  }
}

async function destroyUserSessions(userId) {
  const { error } = await supabase.from("app_sessions").delete().contains("sess", { userId: Number(userId) });
  if (error) console.error("Could not revoke user sessions:", error.message);
}

const sessionMiddleware = session({
  name: "connectchat.sid",
  secret: SESSION_SECRET || crypto.randomBytes(48).toString("hex"),
  store: new SupabaseSessionStore(supabase),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  unset: "destroy",
  proxy: IS_PRODUCTION,
  cookie: {
    maxAge: SESSION_MAX_AGE,
    ...SESSION_COOKIE_OPTIONS
  }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(ROOT, "public"), {
  etag: true,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (/\.(?:html|json)$/.test(filePath) || filePath.endsWith("sw.js")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  }
}));
io.engine.use(sessionMiddleware);

const onlineUsers = new Map();
const activeCallPairs = new Map();

function callPairKey(firstUserId, secondUserId) {
  return [Number(firstUserId), Number(secondUserId)].sort((a, b) => a - b).join(":");
}

function openCallPair(firstUserId, secondUserId) {
  const key = callPairKey(firstUserId, secondUserId);
  const previous = activeCallPairs.get(key);
  if (previous) clearTimeout(previous);
  activeCallPairs.set(key, setTimeout(() => activeCallPairs.delete(key), 4 * 60 * 60 * 1000));
}

function closeCallPair(firstUserId, secondUserId) {
  const key = callPairKey(firstUserId, secondUserId);
  const timer = activeCallPairs.get(key);
  if (timer) clearTimeout(timer);
  activeCallPairs.delete(key);
}

function closeUserCallPairs(userId) {
  const id = Number(userId);
  for (const [key, timer] of activeCallPairs) {
    if (key.split(":").map(Number).includes(id)) {
      clearTimeout(timer);
      activeCallPairs.delete(key);
    }
  }
}

function callPairIsOpen(firstUserId, secondUserId) {
  return activeCallPairs.has(callPairKey(firstUserId, secondUserId));
}

function eventAllowed(socket, name, limit, windowMs) {
  const now = Date.now();
  const current = socket.data.eventLimits?.[name];
  if (!socket.data.eventLimits) socket.data.eventLimits = {};
  if (!current || now - current.startedAt >= windowMs) {
    socket.data.eventLimits[name] = { startedAt: now, count: 1 };
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function validDescription(value, expectedType) {
  return value && value.type === expectedType && typeof value.sdp === "string" && value.sdp.length > 0 && value.sdp.length <= 65536;
}

function validIceCandidate(value) {
  return value && typeof value === "object" && typeof value.candidate === "string" && value.candidate.length <= 4096
    && (value.sdpMid == null || (typeof value.sdpMid === "string" && value.sdpMid.length <= 128))
    && (value.sdpMLineIndex == null || (Number.isInteger(value.sdpMLineIndex) && value.sdpMLineIndex >= 0 && value.sdpMLineIndex < 128));
}

function addOnlineSocket(userId, socketId) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
}

function removeOnlineSocket(userId, socketId) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return true;
  sockets.delete(socketId);
  if (sockets.size) return false;
  onlineUsers.delete(userId);
  return true;
}

async function sendPushToUser(userId, payload) {
  if (!PUSH_ENABLED) return { sent: 0, disabled: true };
  const { data, error } = await supabase.from("push_subscriptions")
    .select("id,endpoint,p256dh,auth").eq("user_id", Number(userId));
  if (error) { console.error("Push subscriptions query failed:", error.message); return { sent: 0, error: true }; }
  let sent = 0;
  for (const row of data || []) {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), { TTL: 60, urgency: "high" });
      sent += 1;
    } catch (error) {
      const code = Number(error.statusCode || 0);
      if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("id", row.id);
      else console.error("Push send failed:", code || error.message);
    }
  }
  return { sent };
}

async function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  try {
    const user = await getUserById(req.session.userId, "id,username,avatar,status,is_admin");
    if (!user) return res.status(401).json({ error: "Account not found" });
    if (user.status !== "approved") {
      return res.status(403).json({
        error: user.status === "blocked" ? "This account has been blocked by the administrator." : "Your account is waiting for administrator approval.",
        code: String(user.status || "pending").toUpperCase()
      });
    }
    req.currentUser = user;
    req.session.username = user.username;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not verify account." });
  }
}

function adminOnly(req, res, next) {
  if (!req.currentUser?.is_admin) return res.status(403).json({ error: "Administrator access is required." });
  next();
}

function safeUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    avatar: row.avatar || null,
    email: row.email || null,
    phone: row.phone || null,
    status: row.status || "approved",
    isAdmin: Boolean(row.is_admin)
  };
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function normalizePhone(value) {
  const source = cleanText(value, 32);
  const hasPlus = source.startsWith("+");
  const digits = source.replace(/\D/g, "");
  return digits ? `${hasPlus ? "+" : ""}${digits}` : "";
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
}

function validPhone(value) {
  return !value || /^\+?[0-9]{8,15}$/.test(value);
}

async function attachSignInOptions(user) {
  if (!user?.id) return user;
  const { data, error } = await supabase.from("users").select("email,phone").eq("id", user.id).maybeSingle();
  if (error) {
    if (error.code === "42703" || /email|phone/i.test(error.message || "")) return { ...user, email: null, phone: null, signInOptionsMigrationRequired: true };
    throw error;
  }
  return { ...user, email: data?.email || null, phone: data?.phone || null };
}

function normalizeRecoveryCode(value) {
  return String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function recoveryHash(code) {
  return crypto.createHmac("sha256", SESSION_SECRET || "local-development")
    .update(normalizeRecoveryCode(code)).digest("hex");
}

function recoveryHashes(code) {
  const normalized = normalizeRecoveryCode(code);
  return [
    recoveryHash(normalized),
    crypto.createHash("sha256").update(normalized).digest("hex")
  ];
}

function createRecoveryCode() {
  const raw = crypto.randomBytes(12).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g).join("-");
}

async function getUserById(id, columns = "id,username,avatar") {
  const { data, error } = await supabase.from("users").select(columns).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function signedMessage(message) {
  if (!message || !message.file_url) return message;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(message.file_url, SIGNED_URL_SECONDS);
  if (error) console.error("Could not sign file URL:", error.message);
  return { ...message, file_url: data?.signedUrl || null };
}

async function signedMessages(messages) {
  return Promise.all((messages || []).map(signedMessage));
}

function avatarProxyUrl(userId, storagePath) {
  if (!storagePath) return null;
  const version = crypto.createHash("sha256").update(String(storagePath)).digest("hex").slice(0, 12);
  return `/api/users/${Number(userId)}/avatar?v=${version}`;
}

async function safeUserWithAvatar(row) {
  const user = safeUser(row);
  user.avatar = avatarProxyUrl(row?.id, row?.avatar);
  return user;
}

async function signedStatus(status) {
  if (!status || !status.file_url) return status;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(status.file_url, SIGNED_URL_SECONDS);
  if (error) console.error("Could not sign status file URL:", error.message);
  return { ...status, file_url: data?.signedUrl || null };
}

async function cleanupExpiredStatuses() {
  const now = new Date().toISOString();
  const { data: expired, error } = await supabase.from("user_statuses")
    .select("id,file_url").lte("expires_at", now).limit(500);
  if (error) throw error;
  const removableIds = [];
  for (const status of expired || []) {
    if (status.file_url) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([status.file_url]);
      if (storageError) {
        console.error("Could not remove expired status file:", storageError.message);
        continue;
      }
    }
    removableIds.push(Number(status.id));
  }
  if (removableIds.length) {
    const { error: deleteError } = await supabase.from("user_statuses").delete().in("id", removableIds);
    if (deleteError) throw deleteError;
  }
}

function messageStatusPayload(message) {
  return {
    messageId: Number(message.id),
    deliveredAt: message.delivered_at || null,
    readAt: message.read_at || null
  };
}

function emitMessageStatus(message) {
  io.to(`user:${Number(message.sender_id)}`).emit("message:status", messageStatusPayload(message));
}

async function markPendingMessagesDelivered(receiverId) {
  const deliveredAt = new Date().toISOString();
  const { data: pending, error: findError } = await supabase.from("messages")
    .select("id,sender_id,receiver_id,read_at")
    .eq("receiver_id", receiverId).is("delivered_at", null).limit(2000);
  if (findError) throw findError;
  const ids = (pending || []).map(message => Number(message.id));
  if (!ids.length) return;
  const { error: updateError } = await supabase.from("messages").update({ delivered_at: deliveredAt }).in("id", ids);
  if (updateError) throw updateError;
  for (const message of pending) emitMessageStatus({ ...message, delivered_at: deliveredAt });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 6, parts: 8 }
});

function cleanText(value, maxLength) {
  return String(value || "").normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function cleanFileName(value) {
  return path.basename(String(value || "file")).normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";
}

async function verifyUpload(file) {
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected) {
    if (!["text/plain", "text/csv"].includes(file.mimetype) || file.buffer.includes(0)) throw new Error("The file content does not match an allowed type.");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(file.buffer);
      return { mime: file.mimetype, ext: file.mimetype === "text/csv" ? "csv" : "txt", kind: "file" };
    } catch {
      throw new Error("Text files must use UTF-8 encoding.");
    }
  }
  let mime = detected.mime;
  if (mime === "video/webm" && file.mimetype === "audio/webm") mime = "audio/webm";
  if (!allowedMimeTypes.includes(mime)) throw new Error("This file type is not allowed.");
  const kind = mime.startsWith("image/") ? "image" : (mime.startsWith("audio/") ? "voice" : (mime.startsWith("video/") ? "video" : "file"));
  return { mime, ext: detected.ext.replace(/[^a-z0-9]/gi, "").slice(0, 10), kind };
}

function basicRecordedVideoSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  // WebM / Matroska EBML header. Browser MediaRecorder WebM begins with this.
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { mime: "video/webm", ext: "webm", kind: "video" };
  }
  // MP4 / MOV ISO Base Media File Format starts with a box followed by "ftyp".
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return { mime: "video/mp4", ext: "mp4", kind: "video" };
  }
  return null;
}

async function verifyRecordedVideo(file) {
  if (!file?.buffer || file.buffer.length < 1024) throw new Error("The video recording is empty.");
  try {
    const verified = await verifyUpload(file);
    if (verified.kind === "video") return verified;
  } catch (error) {
    // Continue to browser-recording signature fallback below. Some MediaRecorder
    // MP4/WebM files are valid and playable but are not identified by file-type.
  }
  const fallback = basicRecordedVideoSignature(file.buffer);
  if (fallback) return fallback;
  throw new Error("The recorded video could not be verified.");
}


async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill("SIGKILL"); reject(new Error("Media conversion timed out.")); } }, 25000);
    child.stderr.on("data", chunk => { stderr += chunk.toString().slice(0, 8192); });
    child.on("error", error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", code => { if (!settled) { settled = true; clearTimeout(timer); code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited with ${code}`)); } });
  });
}

async function normalizeRecordedMedia(file, requestedKind) {
  if (!file?.buffer || !["voice", "video"].includes(requestedKind)) return null;
  const token = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `connectchat-in-${token}`);
  const outputPath = path.join(os.tmpdir(), `connectchat-out-${token}.${requestedKind === "video" ? "mp4" : "m4a"}`);
  try {
    await fs.writeFile(inputPath, file.buffer);
    if (requestedKind === "video") {
      await runFfmpeg(["-i", inputPath, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", outputPath]);
      return { buffer: await fs.readFile(outputPath), mime: "video/mp4", ext: "mp4", kind: "video" };
    }
    await runFfmpeg(["-i", inputPath, "-vn", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", outputPath]);
    return { buffer: await fs.readFile(outputPath), mime: "audio/mp4", ext: "m4a", kind: "voice" };
  } catch (error) {
    console.error("Media normalization failed; using original upload:", error.message);
    return null;
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
}

function validPassword(password) {
  return typeof password === "string" && password.length >= PASSWORD_MIN_LENGTH && password.length <= 128;
}

const dummyPasswordHash = bcrypt.hashSync("not-a-real-connectchat-password", BCRYPT_ROUNDS);

app.post("/api/register", async (req, res) => {
  const username = cleanText(req.body.username, 30);
  const password = String(req.body.password || "");
  if (!/^[A-Za-z0-9_ ]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Use 3–30 letters, numbers, spaces, or underscores." });
  }
  if (!validPassword(password)) return res.status(400).json({ error: `Password must contain ${PASSWORD_MIN_LENGTH}–128 characters.` });

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const recoveryCode = createRecoveryCode();
    const { data, error } = await supabase.from("users").insert({
      username,
      password_hash: passwordHash,
      recovery_hash: recoveryHash(recoveryCode),
      status: "pending",
      is_admin: false
    }).select("id,username,avatar,status,is_admin").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Username already exists." });
      throw error;
    }
    io.emit("users:changed", { reason: "registration", userId: Number(data.id), status: "pending" });
    res.status(201).json({
      ...safeUser(data),
      recoveryCode,
      pending: true,
      message: "Account created. Wait for administrator approval before logging in."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const identifier = cleanText(req.body.username, 254);
    const password = String(req.body.password || "");
    const columns = "id,username,avatar,password_hash,status,is_admin";
    let { data: user, error } = await supabase.from("users").select(columns).eq("username", identifier.slice(0,30)).maybeSingle();
    if (error) throw error;
    if (!user && validEmail(normalizeEmail(identifier)) && identifier.includes("@")) {
      ({ data: user, error } = await supabase.from("users").select(columns).eq("email", normalizeEmail(identifier)).maybeSingle());
    } else if (!user && validPhone(normalizePhone(identifier)) && normalizePhone(identifier)) {
      ({ data: user, error } = await supabase.from("users").select(columns).eq("phone", normalizePhone(identifier)).maybeSingle());
    }
    if (error) {
      if (error.code === "42703" || /email|phone/i.test(error.message || "")) {
        return res.status(503).json({ error: "Email and phone sign-in require the v6.7.3 Supabase migration." });
      }
      throw error;
    }
    const passwordMatches = password.length <= 128 && await bcrypt.compare(password, user?.password_hash || dummyPasswordHash);
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: "Invalid username, email, phone or password." });
    }
    if (user.status !== "approved") {
      return res.status(403).json({
        error: user.status === "blocked" ? "This account has been blocked by the administrator." : "Your account is waiting for administrator approval.",
        code: String(user.status || "pending").toUpperCase()
      });
    }
    const responseUser = await attachSignInOptions(await safeUserWithAvatar(user));
    req.session.regenerate(regenerateError => {
      if (regenerateError) return res.status(500).json({ error: "Login failed." });
      req.session.userId = Number(user.id);
      req.session.username = user.username;
      req.session.save(saveError => {
        if (saveError) return res.status(500).json({ error: "Login failed." });
        res.json(responseUser);
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", (req, res) => {
  const userId = Number(req.session.userId);
  req.session.destroy(() => {
    if (userId) io.in(`user:${userId}`).disconnectSockets(true);
    res.clearCookie("connectchat.sid", SESSION_COOKIE_OPTIONS);
    res.json({ ok: true });
  });
});

app.post("/api/recovery-code", auth, async (req, res) => {
  try {
    const recoveryCode = createRecoveryCode();
    const { error } = await supabase.from("users").update({ recovery_hash: recoveryHash(recoveryCode) }).eq("id", req.session.userId);
    if (error) throw error;
    res.json({ recoveryCode });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not generate recovery code." });
  }
});

app.post("/api/recover/username", async (req, res) => {
  try {
    const code = normalizeRecoveryCode(req.body.recoveryCode);
    if (code.length < 20) return res.status(400).json({ error: "Enter a valid recovery code." });
    const { data: user, error } = await supabase.from("users").select("username").in("recovery_hash", recoveryHashes(code)).maybeSingle();
    if (error) throw error;
    if (!user) return res.status(404).json({ error: "Recovery code not found." });
    res.json({ username: user.username });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Username recovery failed." });
  }
});

app.post("/api/recover/password", async (req, res) => {
  try {
    const code = normalizeRecoveryCode(req.body.recoveryCode);
    const password = String(req.body.newPassword || "");
    if (code.length < 20) return res.status(400).json({ error: "Enter a valid recovery code." });
    if (!validPassword(password)) return res.status(400).json({ error: `Password must contain ${PASSWORD_MIN_LENGTH}–128 characters.` });
    const { data: user, error: findError } = await supabase.from("users").select("id,username").in("recovery_hash", recoveryHashes(code)).maybeSingle();
    if (findError) throw findError;
    if (!user) return res.status(404).json({ error: "Recovery code not found." });
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const recoveryCode = createRecoveryCode();
    const { error } = await supabase.from("users").update({
      password_hash: passwordHash,
      recovery_hash: recoveryHash(recoveryCode)
    }).eq("id", user.id);
    if (error) throw error;
    await destroyUserSessions(user.id);
    io.in(`user:${Number(user.id)}`).disconnectSockets(true);
    res.json({ ok: true, username: user.username, recoveryCode });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Password reset failed." });
  }
});

app.get("/api/me", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  try {
    const user = await getUserById(req.session.userId, "id,username,avatar,status,is_admin");
    if (!user) return res.status(401).json({ error: "Account not found" });
    if (user.status !== "approved") {
      return res.status(403).json({
        error: user.status === "blocked" ? "This account has been blocked by the administrator." : "Your account is waiting for administrator approval."
      });
    }
    res.json(await attachSignInOptions(await safeUserWithAvatar(user)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load account." });
  }
});

app.patch("/api/account/sign-in-options", auth, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const phone = normalizePhone(req.body.phone);
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address or leave it empty." });
  if (!validPhone(phone)) return res.status(400).json({ error: "Enter a phone number with 8–15 digits, including country code." });
  try {
    const { data, error } = await supabase.from("users")
      .update({ email: email || null, phone: phone || null })
      .eq("id", req.currentUser.id)
      .select("email,phone")
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That email address or phone number is already used by another account." });
      if (error.code === "42703" || /email|phone/i.test(error.message || "")) {
        return res.status(503).json({ error: "Run the v6.7.3 email and phone sign-in migration in Supabase first." });
      }
      throw error;
    }
    res.json({ email: data.email || null, phone: data.phone || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update sign-in options." });
  }
});

app.get("/api/users/:userId/avatar", auth, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).end();
    const user = await getUserById(userId, "id,avatar,status");
    if (!user || user.status !== "approved" || !user.avatar) return res.status(404).end();
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(user.avatar);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    const extension = path.extname(String(user.avatar)).toLowerCase();
    const mime = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
      ".webp": "image/webp", ".gif": "image/gif"
    }[extension] || (String(data.type || "").startsWith("image/") ? data.type : "application/octet-stream");
    if (!mime.startsWith("image/")) return res.status(415).end();
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, max-age=3600, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(buffer);
  } catch (error) {
    console.error("Avatar delivery failed:", error);
    res.status(404).end();
  }
});

app.post("/api/profile/avatar", auth, upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a profile photo." });
    const detected = await verifyUpload(req.file);
    if (detected.kind !== "image") return res.status(400).json({ error: "Profile photo must be a JPG, PNG, WEBP, or GIF image." });
    const oldAvatar = req.currentUser.avatar || null;
    const storagePath = `avatars/${Number(req.currentUser.id)}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${detected.ext}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: detected.mime,
      upsert: false
    });
    if (uploadError) throw uploadError;
    const { error: updateError } = await supabase.from("users").update({ avatar: storagePath }).eq("id", req.currentUser.id);
    if (updateError) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      throw updateError;
    }
    if (oldAvatar && oldAvatar !== storagePath) {
      const { error: removeError } = await supabase.storage.from(STORAGE_BUCKET).remove([oldAvatar]);
      if (removeError) console.error("Could not remove previous avatar:", removeError.message);
    }
    const avatar = avatarProxyUrl(req.currentUser.id, storagePath);
    io.emit("profile:updated", { userId: Number(req.currentUser.id), changedAt: new Date().toISOString() });
    io.emit("users:changed");
    res.json({ ok: true, avatar, userId: Number(req.currentUser.id) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Could not upload profile photo." });
  }
});

app.delete("/api/profile/avatar", auth, async (req, res) => {
  try {
    const oldAvatar = req.currentUser.avatar || null;
    const { error } = await supabase.from("users").update({ avatar: null }).eq("id", req.currentUser.id);
    if (error) throw error;
    if (oldAvatar) {
      const { error: removeError } = await supabase.storage.from(STORAGE_BUCKET).remove([oldAvatar]);
      if (removeError) console.error("Could not remove avatar:", removeError.message);
    }
    io.emit("profile:updated", { userId: Number(req.currentUser.id), changedAt: new Date().toISOString() });
    io.emit("users:changed");
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not remove profile photo." });
  }
});

app.get("/api/health", async (_, res) => {
  const { error } = await supabase.from("users").select("id", { head: true, count: "exact" });
  res.status(error ? 503 : 200).json({ ok: !error, version: "6.7.3", build: APP_BUILD });
});

app.get("/api/call-config", auth, (_, res) => {
  if (!CALLS_ENABLED) return res.json({ enabled: false, iceServers: [] });
  const iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(",").map(value => value.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json({ enabled: true, iceServers, turnConfigured: Boolean(process.env.TURN_URL) });
});

app.get("/api/admin/users", auth, adminOnly, async (_, res) => {
  try {
    const { data, error } = await supabase.from("users")
      .select("id,username,status,is_admin,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json((data || []).map(user => ({
      id: Number(user.id),
      username: user.username,
      status: user.status,
      isAdmin: Boolean(user.is_admin),
      createdAt: user.created_at,
      online: onlineUsers.has(Number(user.id))
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load administrator users." });
  }
});

app.post("/api/admin/users/:userId/status", auth, adminOnly, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const status = String(req.body.status || "").toLowerCase();
    if (!userId || !["approved", "blocked"].includes(status)) return res.status(400).json({ error: "Invalid user status." });
    if (userId === Number(req.currentUser.id)) return res.status(400).json({ error: "You cannot change your own administrator status." });
    const target = await getUserById(userId, "id,is_admin");
    if (!target) return res.status(404).json({ error: "User not found." });
    if (target.is_admin) return res.status(400).json({ error: "Another administrator cannot be changed here." });
    const { error } = await supabase.from("users").update({ status }).eq("id", userId);
    if (error) throw error;
    if (status !== "approved") {
      await destroyUserSessions(userId);
      io.in(`user:${userId}`).disconnectSockets(true);
      onlineUsers.delete(userId);
      io.emit("presence", { userId, online: false });
    }
    io.emit("users:changed");
    res.json({ ok: true, status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not change user status." });
  }
});

app.delete("/api/admin/users/:userId", auth, adminOnly, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Invalid user." });
    if (userId === Number(req.currentUser.id)) return res.status(400).json({ error: "You cannot delete your own administrator account." });
    const target = await getUserById(userId, "id,is_admin");
    if (!target) return res.status(404).json({ error: "User not found." });
    if (target.is_admin) return res.status(400).json({ error: "Another administrator cannot be deleted here." });

    const [messageFilesResult, statusFilesResult] = await Promise.all([
      supabase.from("messages").select("file_url")
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).not("file_url", "is", null),
      supabase.from("user_statuses").select("file_url").eq("user_id", userId).not("file_url", "is", null)
    ]);
    if (messageFilesResult.error) throw messageFilesResult.error;
    if (statusFilesResult.error) throw statusFilesResult.error;
    const storagePaths = [...new Set([...(messageFilesResult.data || []), ...(statusFilesResult.data || [])]
      .map(row => row.file_url).filter(Boolean))];
    for (let i = 0; i < storagePaths.length; i += 100) {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths.slice(i, i + 100));
      if (error) console.error("Could not remove deleted user files:", error.message);
    }

    io.in(`user:${userId}`).disconnectSockets(true);
    onlineUsers.delete(userId);
    await destroyUserSessions(userId);
    const { error } = await supabase.from("users").delete().eq("id", userId);
    if (error) throw error;
    io.emit("presence", { userId, online: false });
    io.emit("users:changed");
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete user." });
  }
});

app.delete("/api/account", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const password = String(req.body?.password || "");
    if (req.body?.confirm !== "DELETE MY ACCOUNT") {
      return res.status(400).json({ error: "Account deletion was not confirmed." });
    }
    const account = await getUserById(userId, "id,password_hash,avatar,is_admin");
    if (!account || !(await bcrypt.compare(password, account.password_hash || dummyPasswordHash))) {
      return res.status(401).json({ error: "Your password is incorrect." });
    }
    if (account.is_admin) {
      const { count, error: countError } = await supabase.from("users")
        .select("id", { head: true, count: "exact" }).eq("is_admin", true).neq("id", userId);
      if (countError) throw countError;
      if (!count) return res.status(409).json({ error: "Create or promote another administrator before deleting the last administrator account." });
    }

    const [messageFilesResult, statusFilesResult] = await Promise.all([
      supabase.from("messages").select("file_url")
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).not("file_url", "is", null),
      supabase.from("user_statuses").select("file_url").eq("user_id", userId).not("file_url", "is", null)
    ]);
    if (messageFilesResult.error) throw messageFilesResult.error;
    if (statusFilesResult.error) throw statusFilesResult.error;
    const storagePaths = [...new Set([
      account.avatar,
      ...(messageFilesResult.data || []).map(row => row.file_url),
      ...(statusFilesResult.data || []).map(row => row.file_url)
    ].filter(Boolean))];
    for (let i = 0; i < storagePaths.length; i += 100) {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths.slice(i, i + 100));
      if (error) console.error("Could not remove self-deleted account files:", error.message);
    }

    await destroyUserSessions(userId);
    const { error } = await supabase.from("users").delete().eq("id", userId);
    if (error) throw error;
    onlineUsers.delete(userId);
    io.in(`user:${userId}`).disconnectSockets(true);
    io.emit("presence", { userId, online: false });
    io.emit("users:changed");
    res.json({ ok: true });
  } catch (error) {
    console.error("Self-delete account failed:", error);
    res.status(500).json({ error: "Your account could not be deleted." });
  }
});

function extractOpenAIText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
      else if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function aiPublicStatus() {
  const activeProvider = AI_PROVIDER === "hybrid" ? "Hybrid" : AI_PROVIDER === "ollama" ? "Ollama" : AI_PROVIDER === "deepseek" ? "DeepSeek" : "OpenAI";
  return {
    enabled: AI_ENABLED,
    mode: AI_PROVIDER,
    provider: activeProvider,
    model: AI_PROVIDER === "hybrid" ? "Automatic selection" : AI_PROVIDER === "ollama" ? OLLAMA_MODEL : AI_PROVIDER === "deepseek" ? DEEPSEEK_MODEL : OPENAI_MODEL,
    defaultProvider: AI_DEFAULT_PROVIDER,
    configured: AI_CONFIGURED,
    providers: {
      openai: { available: OPENAI_CONFIGURED, label: "OpenAI", model: OPENAI_MODEL },
      deepseek: { available: DEEPSEEK_CONFIGURED, label: "DeepSeek", model: DEEPSEEK_MODEL },
      ollama: { available: OLLAMA_CONFIGURED, label: "Ollama", model: OLLAMA_MODEL }
    },
    autoFallbackSeconds: Math.round(AI_AUTO_FALLBACK_TIMEOUT_MS / 1000)
  };
}

function aiFailureText(provider, error) {
  const label = provider === "ollama" ? "Ollama" : provider === "deepseek" ? "DeepSeek" : "OpenAI";
  if (error?.name === "AbortError") return `${label} timed out`;
  if (error?.status === 401) return `${label} rejected its credentials`;
  if (error?.status === 429) return `${label} quota or rate limit reached`;
  if (provider === "ollama") return "Ollama server is unreachable";
  return `${label} request failed`;
}

async function requestOpenAI(message, history, signal) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: AI_SYSTEM_PROMPT,
      input: [...history, { role: "user", content: message }],
      max_output_tokens: 1600
    }),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || "OpenAI request failed.");
    error.status = response.status;
    throw error;
  }
  return extractOpenAIText(data);
}

async function requestOllama(message, history, signal) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message }
      ],
      options: { temperature: 0.3 }
    }),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "Ollama request failed.");
    error.status = response.status;
    throw error;
  }
  return String(data?.message?.content || "").trim();
}

async function requestDeepSeek(message, history, signal) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message }
      ],
      stream: false,
      max_tokens: 1600,
      temperature: 0.3
    }),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || "DeepSeek request failed.");
    error.status = response.status;
    throw error;
  }
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

app.get("/api/ai/status", auth, (req, res) => res.json(aiPublicStatus()));

app.post("/api/ai/chat", aiLimiter, auth, async (req, res) => {
  try {
    if (!AI_ENABLED) {
      return res.status(503).json({
        error: "ConnectChat AI is not configured. Check the DeepSeek, OpenAI, or Ollama server settings."
      });
    }
    const message = cleanText(req.body?.message, 4000);
    if (!message) return res.status(400).json({ error: "Please enter a message." });
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];
    const history = rawHistory.map(item => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: cleanText(item?.content, 4000)
    })).filter(item => item.content);
    const requested = ["auto", "openai", "deepseek", "ollama"].includes(req.body?.provider) ? req.body.provider : "auto";
    const allowed = AI_PROVIDER === "hybrid" ? ["deepseek", "openai", "ollama"] : [AI_PROVIDER === "ollama" ? "ollama" : AI_PROVIDER === "deepseek" ? "deepseek" : "openai"];
    const available = allowed.filter(provider => provider === "openai" ? OPENAI_CONFIGURED : provider === "deepseek" ? DEEPSEEK_CONFIGURED : OLLAMA_CONFIGURED);
    let queue;
    if (requested !== "auto") {
      const requestedLabel = requested === "openai" ? "OpenAI" : requested === "deepseek" ? "DeepSeek" : "Ollama";
      if (!allowed.includes(requested)) return res.status(400).json({ error: `${requestedLabel} is disabled by the server administrator.` });
      if (!available.includes(requested)) return res.status(503).json({ error: `${requestedLabel} is not configured on the server.` });
      queue = [requested];
    } else {
      const preferred = available.includes(AI_DEFAULT_PROVIDER) ? AI_DEFAULT_PROVIDER : available[0];
      queue = [preferred, ...available.filter(provider => provider !== preferred)].filter(Boolean);
    }
    let answer = "";
    let usedProvider = "";
    let lastError;
    const failures = [];
    for (let index = 0; index < queue.length; index += 1) {
      const provider = queue[index];
      const controller = new AbortController();
      const attemptTimeout = requested === "auto" && queue.length > 1 && index === 0
        ? Math.min(AI_REQUEST_TIMEOUT_MS, AI_AUTO_FALLBACK_TIMEOUT_MS)
        : AI_REQUEST_TIMEOUT_MS;
      const timeout = setTimeout(() => controller.abort(), attemptTimeout);
      try {
        answer = provider === "ollama"
          ? await requestOllama(message, history, controller.signal)
          : provider === "deepseek"
            ? await requestDeepSeek(message, history, controller.signal)
            : await requestOpenAI(message, history, controller.signal);
        if (answer) { usedProvider = provider; break; }
      } catch (error) {
        lastError = error;
        failures.push(aiFailureText(provider, error));
        console.error(`${provider} AI attempt failed:`, error?.message || error);
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!answer && lastError) {
      return res.status(502).json({
        error: "ConnectChat AI could not answer.",
        details: failures.join(" · "),
        retryable: true
      });
    }
    if (!answer) return res.status(502).json({ error: "ConnectChat AI returned an empty response." });
    res.json({
      answer,
      provider: usedProvider === "ollama" ? "Ollama" : usedProvider === "deepseek" ? "DeepSeek" : "OpenAI",
      model: usedProvider === "ollama" ? OLLAMA_MODEL : usedProvider === "deepseek" ? DEEPSEEK_MODEL : OPENAI_MODEL,
      fallbackUsed: requested === "auto" && queue[0] !== usedProvider,
      status: aiPublicStatus()
    });
  } catch (error) {
    if (error?.name === "AbortError") return res.status(504).json({ error: "ConnectChat AI took too long to respond." });
    console.error("AI chat failed:", error);
    if (error?.status === 401) return res.status(502).json({ error: "The AI provider rejected its API key." });
    if (error?.status === 429) return res.status(429).json({ error: "AI usage limit reached. Please try again shortly." });
    res.status(502).json({ error: "No AI provider could answer. Check the DeepSeek/OpenAI key and confirm that the Ollama server is reachable." });
  }
});

function exportFileName(title, extension) {
  const base = cleanFileName(title || "ConnectChat AI Export").replace(/\.[^.]+$/, "").slice(0, 80);
  return `${base || "ConnectChat AI Export"}.${extension}`;
}

function createPdfBuffer(title, content) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 54, info: { Title: title } });
    const chunks = [];
    pdf.on("data", chunk => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.fontSize(18).fillColor("#25304a").text(title);
    pdf.moveDown();
    pdf.fontSize(10).fillColor("#6b7280").text(`Exported from ConnectChat AI · ${new Date().toISOString()}`);
    pdf.moveDown();
    pdf.fontSize(11).fillColor("#111827").text(content, { lineGap: 3 });
    pdf.end();
  });
}

app.post("/api/ai/export", auth, async (req, res) => {
  try {
    const format = String(req.body?.format || "").toLowerCase();
    const title = cleanText(req.body?.title || "ConnectChat AI Export", 100);
    const content = cleanText(req.body?.content, 50000);
    if (!content) return res.status(400).json({ error: "There is no AI content to export." });
    if (!["docx", "pdf", "xlsx"].includes(format)) return res.status(400).json({ error: "Choose Word, PDF, or Excel." });

    let buffer;
    let mime;
    if (format === "docx") {
      const document = new Document({
        sections: [{
          children: [
            new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
            new Paragraph({ text: `Exported from ConnectChat AI · ${new Date().toISOString()}` }),
            ...content.split(/\r?\n/).map(line => new Paragraph({ text: line || " " }))
          ]
        }]
      });
      buffer = await Packer.toBuffer(document);
      mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "ConnectChat AI";
      const sheet = workbook.addWorksheet("AI Export", { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.columns = [{ header: "Line", key: "line", width: 10 }, { header: "AI content", key: "content", width: 100 }];
      content.split(/\r?\n/).forEach((line, index) => sheet.addRow({ line: index + 1, content: line }));
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B63F6" } };
      sheet.getColumn("content").alignment = { wrapText: true, vertical: "top" };
      buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      buffer = await createPdfBuffer(title, content);
      mime = "application/pdf";
    }
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${exportFileName(title, format)}"`);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (error) {
    console.error("AI export failed:", error);
    res.status(500).json({ error: "The AI result could not be exported." });
  }
});


// ---------------- Enterprise v5 collaboration workspaces ----------------
async function groupAccess(groupId, userId) {
  const { data, error } = await supabase.from("group_members")
    .select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}
async function groupManagerAccess(groupId, userId) {
  const access = await groupAccess(groupId, userId);
  return access && ["owner", "admin"].includes(access.role) ? access : null;
}
async function channelAccess(channelId, userId) {
  const { data, error } = await supabase.from("channel_members")
    .select("role").eq("channel_id", channelId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

app.get("/api/groups", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const { data: memberships, error } = await supabase.from("group_members")
      .select("group_id,role,groups(id,name,description,owner_id,created_at,updated_at)")
      .eq("user_id", userId).order("joined_at", { ascending: false });
    if (error) throw error;
    res.json((memberships || []).map(x => ({ ...x.groups, role: x.role })));
  } catch (error) {
    console.error("List groups failed:", error);
    res.status(500).json({ error: "Groups could not be loaded. Run enterprise-v5-migration.sql." });
  }
});

app.post("/api/groups", auth, async (req, res) => {
  try {
    const ownerId = Number(req.session.userId);
    const name = cleanText(req.body?.name, 80);
    const description = cleanText(req.body?.description, 500);
    const memberIds = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : [])
      .map(Number).filter(id => Number.isSafeInteger(id) && id > 0 && id !== ownerId))].slice(0, 100);
    if (!name) return res.status(400).json({ error: "Group name is required." });
    const { data: group, error } = await supabase.from("groups")
      .insert({ name, description, owner_id: ownerId }).select("*").single();
    if (error) throw error;
    const { error: memberError } = await supabase.from("group_members")
      .insert({ group_id: group.id, user_id: ownerId, role: "owner" });
    if (memberError) throw memberError;
    io.in(`user:${ownerId}`).socketsJoin(`group:${group.id}`);

    let invitations = [];
    if (memberIds.length) {
      const { data: approvedUsers, error: usersError } = await supabase.from("users")
        .select("id").in("id", memberIds).eq("status", "approved");
      if (usersError) throw usersError;
      const approvedIds = (approvedUsers || []).map(user => Number(user.id));
      if (approvedIds.length) {
        const invitationRows = approvedIds.map(invitee_id => ({
          group_id: group.id, invitee_id, invited_by: ownerId, status: "pending"
        }));
        const { data, error: invitationError } = await supabase.from("group_invitations")
          .insert(invitationRows).select("id,group_id,invitee_id,invited_by,status,created_at");
        if (invitationError) throw invitationError;
        invitations = data || [];
        invitations.forEach(invitation => io.to(`user:${invitation.invitee_id}`).emit("group:invitation", {
          ...invitation, groupName: group.name, inviterName: req.currentUser.username
        }));
      }
    }
    res.status(201).json({ ...group, role: "owner", invitationsSent: invitations.length });
  } catch (error) {
    console.error("Create group failed:", error);
    res.status(500).json({ error: "Group could not be created." });
  }
});

app.get("/api/group-invitations", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const { data: invitations, error } = await supabase.from("group_invitations")
      .select("id,group_id,invited_by,status,created_at")
      .eq("invitee_id", userId).eq("status", "pending").order("created_at", { ascending: false });
    if (error) throw error;
    const groupIds = [...new Set((invitations || []).map(item => Number(item.group_id)))];
    const inviterIds = [...new Set((invitations || []).map(item => Number(item.invited_by)))];
    const [{ data: groups, error: groupError }, { data: inviters, error: inviterError }] = await Promise.all([
      groupIds.length ? supabase.from("groups").select("id,name,description").in("id", groupIds) : Promise.resolve({ data: [] }),
      inviterIds.length ? supabase.from("users").select("id,username").in("id", inviterIds) : Promise.resolve({ data: [] })
    ]);
    if (groupError || inviterError) throw groupError || inviterError;
    const groupMap = new Map((groups || []).map(item => [Number(item.id), item]));
    const inviterMap = new Map((inviters || []).map(item => [Number(item.id), item.username]));
    res.json((invitations || []).map(item => ({
      ...item,
      group: groupMap.get(Number(item.group_id)) || null,
      inviterName: inviterMap.get(Number(item.invited_by)) || "Group administrator"
    })));
  } catch (error) {
    console.error("List group invitations failed:", error);
    res.status(500).json({ error: "Invitations could not be loaded. Run v6.7.3-group-invitations-migration.sql." });
  }
});

app.post("/api/groups/:groupId/invitations", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), inviterId = Number(req.session.userId), inviteeId = Number(req.body?.userId);
    if (!Number.isSafeInteger(groupId) || !Number.isSafeInteger(inviteeId) || inviteeId <= 0) return res.status(400).json({ error: "Choose a valid user." });
    if (!(await groupManagerAccess(groupId, inviterId))) return res.status(403).json({ error: "Only the group owner or an administrator can invite users." });
    const [{ data: invitee, error: userError }, { data: membership, error: memberError }] = await Promise.all([
      supabase.from("users").select("id,username,status").eq("id", inviteeId).maybeSingle(),
      supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", inviteeId).maybeSingle()
    ]);
    if (userError || memberError) throw userError || memberError;
    if (!invitee || invitee.status !== "approved") return res.status(400).json({ error: "Only approved users can be invited." });
    if (membership) return res.status(409).json({ error: "This user is already a group member." });
    const { data, error } = await supabase.from("group_invitations").insert({
      group_id: groupId, invitee_id: inviteeId, invited_by: inviterId, status: "pending"
    }).select("id,group_id,invitee_id,invited_by,status,created_at").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "A pending invitation already exists for this user." });
      throw error;
    }
    io.to(`user:${inviteeId}`).emit("group:invitation", { ...data, inviterName: req.currentUser.username });
    res.status(201).json(data);
  } catch (error) {
    console.error("Create group invitation failed:", error);
    res.status(500).json({ error: "Invitation could not be sent. Run v6.7.3-group-invitations-migration.sql." });
  }
});

app.post("/api/group-invitations/:invitationId/respond", auth, async (req, res) => {
  try {
    const invitationId = Number(req.params.invitationId), userId = Number(req.session.userId);
    const action = req.body?.action === "accept" ? "accepted" : req.body?.action === "decline" ? "declined" : "";
    if (!Number.isSafeInteger(invitationId) || !action) return res.status(400).json({ error: "Choose Accept or Decline." });
    const { data: invitation, error } = await supabase.from("group_invitations")
      .select("id,group_id,invitee_id,status").eq("id", invitationId).eq("invitee_id", userId).maybeSingle();
    if (error) throw error;
    if (!invitation || invitation.status !== "pending") return res.status(404).json({ error: "This invitation is no longer pending." });
    if (action === "accepted") {
      const { error: memberError } = await supabase.from("group_members")
        .upsert({ group_id: invitation.group_id, user_id: userId, role: "member" }, { onConflict: "group_id,user_id", ignoreDuplicates: true });
      if (memberError) throw memberError;
      io.in(`user:${userId}`).socketsJoin(`group:${invitation.group_id}`);
    }
    const { error: updateError } = await supabase.from("group_invitations")
      .update({ status: action, responded_at: new Date().toISOString() }).eq("id", invitationId).eq("status", "pending");
    if (updateError) throw updateError;
    res.json({ ok: true, status: action, groupId: invitation.group_id });
  } catch (error) {
    console.error("Respond to group invitation failed:", error);
    res.status(500).json({ error: "Invitation response could not be saved." });
  }
});

app.get("/api/groups/:groupId/members", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), userId = Number(req.session.userId);
    const access = await groupAccess(groupId, userId);
    if (!access) return res.status(403).json({ error: "Access denied." });
    const { data: rows, error } = await supabase.from("group_members")
      .select("user_id,role,joined_at").eq("group_id", groupId).order("joined_at");
    if (error) throw error;
    let pendingInvitations = [];
    if (["owner", "admin"].includes(access.role)) {
      const { data: invitations, error: invitationError } = await supabase.from("group_invitations")
        .select("id,invitee_id,invited_by,created_at").eq("group_id", groupId).eq("status", "pending").order("created_at");
      if (invitationError) throw invitationError;
      pendingInvitations = invitations || [];
    }
    const ids = [...new Set([
      ...(rows || []).map(row => Number(row.user_id)),
      ...pendingInvitations.map(row => Number(row.invitee_id))
    ])];
    const { data: people, error: peopleError } = ids.length
      ? await supabase.from("users").select("id,username,avatar,status").in("id", ids)
      : { data: [], error: null };
    if (peopleError) throw peopleError;
    const peopleMap = new Map((people || []).map(person => [Number(person.id), person]));
    res.json({
      viewerRole: access.role,
      members: (rows || []).map(row => {
        const person = peopleMap.get(Number(row.user_id)) || {};
        return {
          id: Number(row.user_id),
          username: person.username || "User",
          avatar: avatarProxyUrl(row.user_id, person.avatar),
          role: row.role,
          joinedAt: row.joined_at
        };
      }),
      invitations: pendingInvitations.map(invitation => {
        const person = peopleMap.get(Number(invitation.invitee_id)) || {};
        return {
          id: Number(invitation.id),
          userId: Number(invitation.invitee_id),
          username: person.username || "User",
          createdAt: invitation.created_at
        };
      })
    });
  } catch (error) {
    console.error("List group members failed:", error);
    res.status(500).json({ error: "Group members could not be loaded." });
  }
});

app.post("/api/groups/:groupId/members", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), managerId = Number(req.session.userId), newUserId = Number(req.body?.userId);
    if (!(await groupManagerAccess(groupId, managerId))) return res.status(403).json({ error: "Only the owner or a group administrator can add members." });
    const { data: user, error: userError } = await supabase.from("users").select("id,status").eq("id", newUserId).maybeSingle();
    if (userError) throw userError;
    if (!user || user.status !== "approved") return res.status(400).json({ error: "Choose an approved user." });
    const { error } = await supabase.from("group_members").insert({ group_id: groupId, user_id: newUserId, role: "member" });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "This user is already a member." });
      throw error;
    }
    await supabase.from("group_invitations").update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("group_id", groupId).eq("invitee_id", newUserId).eq("status", "pending");
    io.in(`user:${newUserId}`).socketsJoin(`group:${groupId}`);
    io.to(`user:${newUserId}`).emit("group:added", { groupId });
    io.to(`group:${groupId}`).emit("group:members-changed", { groupId });
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Add group member failed:", error);
    res.status(500).json({ error: "Member could not be added." });
  }
});

app.delete("/api/groups/:groupId/members/:memberId", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), managerId = Number(req.session.userId), memberId = Number(req.params.memberId);
    const manager = await groupManagerAccess(groupId, managerId);
    if (!manager) return res.status(403).json({ error: "Only the owner or a group administrator can remove members." });
    const target = await groupAccess(groupId, memberId);
    if (!target) return res.status(404).json({ error: "Member not found." });
    if (target.role === "owner") return res.status(403).json({ error: "The group owner cannot be removed." });
    if (manager.role === "admin" && target.role === "admin") return res.status(403).json({ error: "Only the owner can remove another administrator." });
    const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", memberId);
    if (error) throw error;
    io.to(`user:${memberId}`).emit("group:removed", { groupId });
    io.in(`user:${memberId}`).socketsLeave(`group:${groupId}`);
    io.to(`group:${groupId}`).emit("group:members-changed", { groupId });
    res.json({ ok: true });
  } catch (error) {
    console.error("Remove group member failed:", error);
    res.status(500).json({ error: "Member could not be removed." });
  }
});

app.patch("/api/groups/:groupId/members/:memberId/role", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), ownerId = Number(req.session.userId), memberId = Number(req.params.memberId);
    const owner = await groupAccess(groupId, ownerId);
    if (!owner || owner.role !== "owner") return res.status(403).json({ error: "Only the group owner can change administrator roles." });
    const role = req.body?.role === "admin" ? "admin" : req.body?.role === "member" ? "member" : "";
    if (!role) return res.status(400).json({ error: "Choose Admin or Member." });
    const target = await groupAccess(groupId, memberId);
    if (!target || target.role === "owner") return res.status(400).json({ error: "The owner role cannot be changed." });
    const { error } = await supabase.from("group_members").update({ role }).eq("group_id", groupId).eq("user_id", memberId);
    if (error) throw error;
    io.to(`group:${groupId}`).emit("group:members-changed", { groupId });
    res.json({ ok: true, role });
  } catch (error) {
    console.error("Change group role failed:", error);
    res.status(500).json({ error: "Member role could not be changed." });
  }
});

app.get("/api/groups/:groupId/messages", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), userId = Number(req.session.userId);
    if (!Number.isSafeInteger(groupId) || !(await groupAccess(groupId, userId))) return res.status(403).json({ error: "Access denied." });
    // Read attachment fields when the v6.5.1 migration is installed, while
    // remaining compatible with older group_messages tables that contain only
    // id, group_id, sender_id, body and created_at.
    let result = await supabase.from("group_messages")
      .select("id,group_id,sender_id,kind,body,file_url,file_name,mime_type,created_at")
      .eq("group_id", groupId).order("created_at", { ascending: true }).limit(500);
    if (result.error) {
      console.warn("Using basic group-message compatibility query:", result.error.message);
      result = await supabase.from("group_messages")
        .select("id,group_id,sender_id,body,created_at")
        .eq("group_id", groupId).order("created_at", { ascending: true }).limit(500);
    }
    if (result.error) throw result.error;
    const messages = result.data || [];
    const senderIds = [...new Set(messages.map(message => Number(message.sender_id)).filter(Number.isSafeInteger))];
    const { data: senders, error: sendersError } = senderIds.length
      ? await supabase.from("users").select("id,username,avatar").in("id", senderIds)
      : { data: [], error: null };
    if (sendersError) throw sendersError;
    const senderMap = new Map((senders || []).map(sender => [Number(sender.id), sender]));
    const prepared = await signedMessages(messages.map(message => {
      const sender = senderMap.get(Number(message.sender_id));
      return {
      ...message,
      kind: message.kind || "text",
      file_url: message.file_url || null,
      file_name: message.file_name || null,
      mime_type: message.mime_type || null,
      sender_name: sender?.username || "User",
      avatar_url: avatarProxyUrl(message.sender_id, sender?.avatar)
    };
    }));
    res.json(prepared);
  } catch (error) {
    console.error("Group messages failed:", error);
    res.status(500).json({ error: "Group messages could not be loaded." });
  }
});

app.post("/api/groups/:groupId/upload", auth, upload.single("file"), async (req, res) => {
  let storagePath;
  try {
    const groupId = Number(req.params.groupId), senderId = Number(req.session.userId);
    if (!req.file || !Number.isSafeInteger(groupId) || !(await groupAccess(groupId, senderId))) {
      return res.status(403).json({ error: "Group access or file is missing." });
    }
    const verified = await verifyUpload(req.file);
    const extension = verified.ext ? `.${verified.ext}` : "";
    storagePath = `groups/${groupId}/${senderId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: verified.mime, cacheControl: "900", upsert: false
    });
    if (uploadError) throw uploadError;
    const { data, error } = await supabase.from("group_messages").insert({
      group_id: groupId,
      sender_id: senderId,
      kind: verified.kind,
      body: cleanText(req.body.caption, 500),
      file_url: storagePath,
      file_name: cleanFileName(req.file.originalname),
      mime_type: verified.mime
    }).select("id,group_id,sender_id,kind,body,file_url,file_name,mime_type,created_at").single();
    if (error) throw error;
    const outgoing = await signedMessage({ ...data, sender_name: req.session.username || "User" });
    io.to(`group:${groupId}`).emit("group:message", outgoing);
    res.status(201).json(outgoing);
  } catch (error) {
    if (storagePath) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    console.error("Group upload failed:", error);
    const safeMessages = new Set([
      "The file content does not match an allowed type.",
      "This file type is not allowed.",
      "Text files must use UTF-8 encoding.",
      "The recorded media type could not be verified.",
      "The recorded video could not be verified.",
      "The recorded video format is not supported.",
      "The video recording is empty."
    ]);
    res.status(400).json({ error: safeMessages.has(error.message) ? error.message : "Group file upload failed. Run v6.5.1-group-attachments-migration.sql." });
  }
});

app.post("/api/groups/:groupId/messages", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), senderId = Number(req.session.userId);
    const body = cleanText(req.body?.body, 4000);
    if (!body) return res.status(400).json({ error: "Message is required." });
    if (!Number.isSafeInteger(groupId) || !(await groupAccess(groupId, senderId))) return res.status(403).json({ error: "Access denied." });
    const { data, error } = await supabase.from("group_messages")
      .insert({ group_id: groupId, sender_id: senderId, body }).select("*").single();
    if (error) throw error;
    io.to(`group:${groupId}`).emit("group:message", { ...data, sender_name: req.session.username || "User" });
    res.status(201).json(data);
  } catch (error) {
    console.error("Send group message failed:", error);
    res.status(500).json({ error: "Group message could not be sent." });
  }
});

app.delete("/api/groups/:groupId", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), userId = Number(req.session.userId);
    const access = await groupAccess(groupId, userId);
    if (!access || access.role !== "owner") return res.status(403).json({ error: "Only the owner can delete this group." });
    const { error } = await supabase.from("groups").delete().eq("id", groupId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    console.error("Delete group failed:", error);
    res.status(500).json({ error: "Group could not be deleted." });
  }
});

app.get("/api/channels", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const { data: privateRows, error } = await supabase.from("channel_members")
      .select("channel_id,role,channels(id,name,description,visibility,owner_id,created_at,updated_at)")
      .eq("user_id", userId).order("joined_at", { ascending: false });
    if (error) throw error;
    const { data: publicRows, error: publicError } = await supabase.from("channels")
      .select("id,name,description,visibility,owner_id,created_at,updated_at").eq("visibility", "public");
    if (publicError) throw publicError;
    const map = new Map();
    (publicRows || []).forEach(c => map.set(Number(c.id), { ...c, role: "viewer" }));
    (privateRows || []).forEach(x => map.set(Number(x.channels.id), { ...x.channels, role: x.role }));
    res.json([...map.values()]);
  } catch (error) {
    console.error("List channels failed:", error);
    res.status(500).json({ error: "Channels could not be loaded. Run enterprise-v5-migration.sql." });
  }
});

app.post("/api/channels", auth, async (req, res) => {
  try {
    const ownerId = Number(req.session.userId);
    const name = cleanText(req.body?.name, 80).replace(/\s+/g, "-");
    const description = cleanText(req.body?.description, 500);
    const visibility = req.body?.visibility === "public" ? "public" : "private";
    if (!name) return res.status(400).json({ error: "Channel name is required." });
    const { data: channel, error } = await supabase.from("channels")
      .insert({ name, description, visibility, owner_id: ownerId }).select("*").single();
    if (error) throw error;
    const { error: memberError } = await supabase.from("channel_members")
      .insert({ channel_id: channel.id, user_id: ownerId, role: "owner" });
    if (memberError) throw memberError;
    res.status(201).json({ ...channel, role: "owner" });
  } catch (error) {
    console.error("Create channel failed:", error);
    res.status(500).json({ error: "Channel could not be created." });
  }
});

app.get("/api/channels/:channelId/posts", auth, async (req, res) => {
  try {
    const channelId = Number(req.params.channelId), userId = Number(req.session.userId);
    const { data: channel, error: channelError } = await supabase.from("channels").select("visibility").eq("id", channelId).maybeSingle();
    if (channelError) throw channelError;
    if (!channel || (channel.visibility !== "public" && !(await channelAccess(channelId, userId)))) return res.status(403).json({ error: "Access denied." });
    const { data, error } = await supabase.from("channel_posts")
      .select("id,channel_id,author_id,body,parent_post_id,is_announcement,created_at,users!channel_posts_author_id_fkey(username,avatar_url)")
      .eq("channel_id", channelId).order("created_at", { ascending: true }).limit(500);
    if (error) throw error;
    res.json((data || []).map(p => ({ ...p, author_name: p.users?.username || "User", avatar_url: p.users?.avatar_url || null, users: undefined })));
  } catch (error) {
    console.error("Channel posts failed:", error);
    res.status(500).json({ error: "Channel posts could not be loaded." });
  }
});

app.post("/api/channels/:channelId/posts", auth, async (req, res) => {
  try {
    const channelId = Number(req.params.channelId), authorId = Number(req.session.userId);
    const body = cleanText(req.body?.body, 8000);
    if (!body) return res.status(400).json({ error: "Post text is required." });
    const { data: channel, error: channelError } = await supabase.from("channels").select("visibility").eq("id", channelId).maybeSingle();
    if (channelError) throw channelError;
    if (!channel || (channel.visibility !== "public" && !(await channelAccess(channelId, authorId)))) return res.status(403).json({ error: "Access denied." });
    const row = { channel_id: channelId, author_id: authorId, body, is_announcement: req.body?.isAnnouncement === true };
    const { data, error } = await supabase.from("channel_posts").insert(row).select("*").single();
    if (error) throw error;
    io.to(`channel:${channelId}`).emit("channel:post", { ...data, author_name: req.session.username || "User" });
    res.status(201).json(data);
  } catch (error) {
    console.error("Create channel post failed:", error);
    res.status(500).json({ error: "Channel post could not be created." });
  }
});

app.delete("/api/channels/:channelId", auth, async (req, res) => {
  try {
    const channelId = Number(req.params.channelId), userId = Number(req.session.userId);
    const access = await channelAccess(channelId, userId);
    if (!access || access.role !== "owner") return res.status(403).json({ error: "Only the owner can delete this channel." });
    const { error } = await supabase.from("channels").delete().eq("id", channelId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    console.error("Delete channel failed:", error);
    res.status(500).json({ error: "Channel could not be deleted." });
  }
});

app.get("/api/calls", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const { data, error } = await supabase.from("call_logs")
      .select("id,caller_id,receiver_id,mode,status,started_at,ended_at")
      .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
      .order("started_at", { ascending: false }).limit(100);
    if (error) throw error;
    const userIds = [...new Set((data || []).flatMap(x => [Number(x.caller_id), Number(x.receiver_id)]))];
    const { data: people, error: peopleError } = userIds.length
      ? await supabase.from("users").select("id,username,avatar").in("id", userIds)
      : { data: [], error: null };
    if (peopleError) throw peopleError;
    const peopleMap = new Map((people || []).map(x => [Number(x.id), {
      id: x.id,
      username: x.username,
      avatar: avatarProxyUrl(x.id, x.avatar)
    }]));
    res.json((data || []).map(x => ({ ...x, caller: peopleMap.get(Number(x.caller_id)), receiver: peopleMap.get(Number(x.receiver_id)) })));
  } catch (error) {
    console.error("Call history failed:", error);
    res.status(500).json({ error: "Call history could not be loaded. Run enterprise-v5-migration.sql." });
  }
});

app.delete("/api/calls", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const { data, error } = await supabase.from("call_logs")
      .delete()
      .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
      .select("id");
    if (error) throw error;
    res.json({ ok: true, deleted: (data || []).length });
  } catch (error) {
    console.error("Clear call history failed:", error);
    res.status(500).json({ error: "Call history could not be cleared." });
  }
});

const calculationSheetMimeTypes = new Set([
  "application/pdf", "text/csv", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

async function calculationSheetView(row, usernames = new Map(), adminIds = new Set(), viewer = null) {
  const uploaderIsAdmin = adminIds.has(Number(row.uploader_id));
  return {
    id: Number(row.id),
    uploaderId: Number(row.uploader_id),
    uploaderName: usernames.get(Number(row.uploader_id)) || "User",
    title: row.title,
    description: row.description || "",
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size || 0),
    accessScope: row.access_scope || "all",
    createdAt: row.created_at,
    canDownload: Boolean(viewer?.is_admin) || Number(row.uploader_id) === Number(viewer?.id) || !uploaderIsAdmin
  };
}

async function calculationSheetAllowed(row, user) {
  if (user.is_admin || Number(row.uploader_id) === Number(user.id) || row.access_scope === "all") return true;
  if (row.access_scope === "admins") return false;
  if (row.access_scope === "selected") {
    const { data, error } = await supabase.from("calculation_sheet_access")
      .select("sheet_id").eq("sheet_id", row.id).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  return false;
}

function calculationSheetFormat(row, buffer) {
  const extension = path.extname(String(row.file_name || "")).toLowerCase();
  if (buffer?.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (extension === ".csv" || row.mime_type === "text/csv") return "csv";
  if (extension === ".xls") return "xls";
  if ([".xlsx", ".xlsm", ".xltx", ".xltm"].includes(extension)) return "xlsx";
  if (row.mime_type === "application/pdf") return "pdf";
  if (row.mime_type === "application/vnd.ms-excel") return "xls";
  if (row.mime_type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  return "unknown";
}

async function loadCalculationWorkbook(buffer, format) {
  const workbook = new ExcelJS.Workbook();
  if (format === "csv") {
    await workbook.csv.read(Readable.from(buffer));
    return workbook;
  }
  try {
    await workbook.xlsx.load(buffer);
    return workbook;
  } catch (initialError) {
    const fallbackWorkbook = new ExcelJS.Workbook();
    try {
      await fallbackWorkbook.xlsx.load(buffer, {
        ignoreNodes: [
          "dataValidations", "extLst", "drawing", "hyperlinks",
          "conditionalFormatting", "headerFooter", "picture"
        ]
      });
      return fallbackWorkbook;
    } catch {
      throw initialError;
    }
  }
}

app.get("/api/calculation-sheets", auth, async (req, res) => {
  try {
    const { data: sheets, error } = await supabase.from("calculation_sheets")
      .select("id,uploader_id,title,description,storage_path,file_name,mime_type,file_size,access_scope,created_at")
      .order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    let visibleSheets = sheets || [];
    if (!req.currentUser.is_admin) {
      const { data: grants, error: grantError } = await supabase.from("calculation_sheet_access")
        .select("sheet_id").eq("user_id", req.currentUser.id);
      if (grantError) throw grantError;
      const selectedIds = new Set((grants || []).map(grant => Number(grant.sheet_id)));
      visibleSheets = visibleSheets.filter(row =>
        Number(row.uploader_id) === Number(req.currentUser.id) ||
        row.access_scope === "all" ||
        (row.access_scope === "selected" && selectedIds.has(Number(row.id)))
      );
    }
    const ids = [...new Set(visibleSheets.map(row => Number(row.uploader_id)))];
    const { data: people, error: peopleError } = ids.length
      ? await supabase.from("users").select("id,username,is_admin").in("id", ids)
      : { data: [], error: null };
    if (peopleError) throw peopleError;
    const usernames = new Map((people || []).map(person => [Number(person.id), person.username]));
    const adminIds = new Set((people || []).filter(person => person.is_admin).map(person => Number(person.id)));
    res.json(await Promise.all(visibleSheets.map(row => calculationSheetView(row, usernames, adminIds, req.currentUser))));
  } catch (error) {
    console.error("Calculation sheets failed:", error);
    res.status(500).json({ error: "Calculation sheets are unavailable. Run v6-calculation-sheets-migration.sql once." });
  }
});

app.post("/api/calculation-sheets", uploadLimiter, auth, upload.single("sheet"), async (req, res) => {
  let storagePath;
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a calculation sheet." });
    const verified = await verifyUpload(req.file);
    if (!calculationSheetMimeTypes.has(verified.mime)) {
      return res.status(400).json({ error: "Calculation sheets must be XLSX, XLS, CSV, or PDF." });
    }
    const title = cleanText(req.body?.title || req.file.originalname, 120);
    const description = cleanText(req.body?.description, 500);
    const requestedScope = cleanText(req.body?.accessScope, 20);
    const accessScope = req.currentUser.is_admin && ["all", "admins", "selected"].includes(requestedScope)
      ? requestedScope
      : "all";
    let allowedUserIds = [];
    if (accessScope === "selected") {
      try {
        allowedUserIds = [...new Set(JSON.parse(req.body?.allowedUserIds || "[]").map(Number))]
          .filter(id => Number.isSafeInteger(id) && id > 0 && id !== Number(req.currentUser.id)).slice(0, 200);
      } catch {
        return res.status(400).json({ error: "Selected-user permissions are invalid." });
      }
      if (!allowedUserIds.length) return res.status(400).json({ error: "Select at least one user." });
      const { data: approved, error: approvedError } = await supabase.from("users")
        .select("id").in("id", allowedUserIds).eq("status", "approved");
      if (approvedError) throw approvedError;
      allowedUserIds = (approved || []).map(user => Number(user.id));
      if (!allowedUserIds.length) return res.status(400).json({ error: "No approved selected users were found." });
    }
    const extension = verified.ext ? `.${verified.ext}` : "";
    storagePath = `calculation-sheets/${Number(req.currentUser.id)}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: verified.mime,
      cacheControl: "900",
      upsert: false
    });
    if (uploadError) throw uploadError;
    const { data: row, error } = await supabase.from("calculation_sheets").insert({
      uploader_id: req.currentUser.id,
      title,
      description,
      storage_path: storagePath,
      file_name: cleanFileName(req.file.originalname),
      mime_type: verified.mime,
      file_size: req.file.size,
      access_scope: accessScope
    }).select("id,uploader_id,title,description,storage_path,file_name,mime_type,file_size,access_scope,created_at").single();
    if (error) throw error;
    if (accessScope === "selected") {
      const { error: grantError } = await supabase.from("calculation_sheet_access").insert(
        allowedUserIds.map(userId => ({ sheet_id: row.id, user_id: userId }))
      );
      if (grantError) {
        await supabase.from("calculation_sheets").delete().eq("id", row.id);
        throw grantError;
      }
    }
    res.json(await calculationSheetView(
      row,
      new Map([[Number(req.currentUser.id), req.currentUser.username]]),
      new Set(req.currentUser.is_admin ? [Number(req.currentUser.id)] : []),
      req.currentUser
    ));
  } catch (error) {
    if (storagePath) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    console.error("Calculation sheet upload failed:", error);
    res.status(400).json({ error: error.message || "Calculation sheet upload failed." });
  }
});

app.get("/api/calculation-sheets/:id/download", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid calculation sheet." });
    const { data: row, error } = await supabase.from("calculation_sheets")
      .select("id,uploader_id,file_name,mime_type,storage_path,access_scope").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: "Calculation sheet not found." });
    if (!await calculationSheetAllowed(row, req.currentUser)) return res.status(403).json({ error: "This calculation sheet was not shared with your account." });
    const uploader = await getUserById(Number(row.uploader_id), "id,is_admin");
    if (uploader?.is_admin && !req.currentUser.is_admin) {
      return res.status(403).json({ error: "Administrator calculation sheets are preview-only. You may view the sheet and its saved results, but downloading the original file is restricted." });
    }
    const { data, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(row.storage_path);
    if (downloadError) throw downloadError;
    const buffer = Buffer.from(await data.arrayBuffer());
    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${cleanFileName(row.file_name)}"`);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (error) {
    console.error("Calculation sheet download failed:", error);
    res.status(500).json({ error: "The calculation sheet could not be downloaded." });
  }
});

app.get("/api/calculation-sheets/:id/preview", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid calculation sheet." });
    const { data: row, error } = await supabase.from("calculation_sheets")
      .select("id,uploader_id,title,file_name,mime_type,storage_path,access_scope").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: "Calculation sheet not found." });
    if (!await calculationSheetAllowed(row, req.currentUser)) return res.status(403).json({ error: "This calculation sheet was not shared with your account." });
    const { data, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(row.storage_path);
    if (downloadError) throw downloadError;
    const buffer = Buffer.from(await data.arrayBuffer());
    const format = calculationSheetFormat(row, buffer);
    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${cleanFileName(row.file_name)}"`);
      return res.end(buffer);
    }
    if (format === "xls") {
      return res.status(415).json({ error: "Legacy XLS files can be downloaded but cannot be previewed safely. Save the file as XLSX to enable preview." });
    }
    if (!["xlsx", "csv"].includes(format)) {
      return res.status(415).json({ error: "This file format cannot be previewed. Upload an XLSX, CSV, or PDF file." });
    }
    const workbook = await loadCalculationWorkbook(buffer, format);
    const requestedSheet = cleanText(req.query?.sheet, 100);
    const worksheet = workbook.getWorksheet(requestedSheet) || workbook.worksheets[0];
    if (!worksheet) return res.status(422).json({ error: "The workbook does not contain a readable worksheet." });
    const rows = [];
    worksheet.eachRow({ includeEmpty: true }, sheetRow => {
      if (rows.length >= 500) return;
      const values = [];
      const lastColumn = Math.min(sheetRow.cellCount || sheetRow.actualCellCount || 0, 100);
      for (let column = 1; column <= lastColumn; column += 1) {
        const cell = sheetRow.getCell(column);
        const value = cell.value && typeof cell.value === "object" && "result" in cell.value ? cell.value.result : cell.text;
        values.push(cleanText(value ?? "", 2000));
      }
      rows.push(values);
    });
    res.json({
      kind: "spreadsheet",
      title: row.title,
      fileName: row.file_name,
      sheetNames: workbook.worksheets.map(sheet => sheet.name).slice(0, 50),
      activeSheet: worksheet.name,
      rows,
      truncated: worksheet.rowCount > 500 || worksheet.columnCount > 100,
      note: "Formula results are the values saved in the uploaded workbook; ConnectChat does not recalculate Excel formulas."
    });
  } catch (error) {
    console.error("Calculation sheet preview failed:", error);
    res.status(422).json({ error: "This calculation sheet could not be previewed. Download it to open in its original application." });
  }
});

app.delete("/api/calculation-sheets/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid calculation sheet." });
    const { data: row, error } = await supabase.from("calculation_sheets")
      .select("id,uploader_id,storage_path").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: "Calculation sheet not found." });
    if (Number(row.uploader_id) !== Number(req.currentUser.id) && !req.currentUser.is_admin) {
      return res.status(403).json({ error: "Only the uploader or administrator can delete this sheet." });
    }
    const { error: deleteError } = await supabase.from("calculation_sheets").delete().eq("id", id);
    if (deleteError) throw deleteError;
    const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([row.storage_path]);
    if (storageError) console.error("Could not remove calculation sheet file:", storageError.message);
    res.json({ ok: true });
  } catch (error) {
    console.error("Calculation sheet delete failed:", error);
    res.status(500).json({ error: "The calculation sheet could not be deleted." });
  }
});

app.get("/api/files", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const { data, error } = await supabase.from("messages")
      .select("id,sender_id,receiver_id,kind,file_url,file_name,mime_type,created_at")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .neq("kind", "text").order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error("Files workspace failed:", error);
    res.status(500).json({ error: "Files could not be loaded." });
  }
});


app.get("/api/push/public-key", auth, (req, res) => {
  res.json({ enabled: PUSH_ENABLED, publicKey: PUSH_ENABLED ? VAPID_PUBLIC_KEY : "" });
});

app.post("/api/push/subscribe", auth, async (req, res) => {
  try {
    if (!PUSH_ENABLED) return res.status(503).json({ error: "Push notifications are not configured on the server." });
    const sub = req.body?.subscription || req.body;
    const endpoint = String(sub?.endpoint || "").slice(0, 2000);
    const p256dh = String(sub?.keys?.p256dh || "").slice(0, 500);
    const authKey = String(sub?.keys?.auth || "").slice(0, 500);
    if (!endpoint || !p256dh || !authKey) return res.status(400).json({ error: "Invalid push subscription." });
    const { error } = await supabase.from("push_subscriptions").upsert({ user_id: Number(req.currentUser.id), endpoint, p256dh, auth: authKey, updated_at: new Date().toISOString() }, { onConflict: "endpoint" });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { console.error("Push subscribe failed:", error); res.status(500).json({ error: "Push subscription could not be saved. Run the push migration SQL." }); }
});

app.post("/api/push/unsubscribe", auth, async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || "").slice(0, 2000);
    if (endpoint) await supabase.from("push_subscriptions").delete().eq("user_id", Number(req.currentUser.id)).eq("endpoint", endpoint);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

app.get("/api/users", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const [{ data: users, error: userError }, { data: messages, error: messageError }] = await Promise.all([
      supabase.from("users").select("id,username,avatar,last_seen_at").eq("status", "approved").order("username", { ascending: true }),
      supabase.from("messages").select("id,sender_id,receiver_id,kind,body").or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order("id", { ascending: false }).limit(2000)
    ]);
    if (userError) throw userError;
    if (messageError) throw messageError;
    const latest = new Map();
    for (const message of messages || []) {
      const otherId = Number(message.sender_id) === userId ? Number(message.receiver_id) : Number(message.sender_id);
      if (!latest.has(otherId)) latest.set(otherId, message);
    }
    const result = await Promise.all((users || []).map(async user => {
      const id = Number(user.id);
      const isSelf = id === userId;
      const last = latest.get(id);
      return {
        id,
        username: user.username,
        avatar: avatarProxyUrl(user.id, user.avatar),
        isSelf,
        displayName: isSelf ? `${user.username} (You)` : user.username,
        online: isSelf || onlineUsers.has(id),
        lastSeenAt: user.last_seen_at || null,
        lastPreview: last ? (last.kind !== "text" ? `[${last.kind}]` : (last.body || "Message")) : (isSelf ? "Your private conversation" : "Start a conversation")
      };
    }));
    result.unshift({
      id: -1,
      username: "ConnectChat AI",
      displayName: "ConnectChat AI",
      isAI: true,
      isSelf: false,
      online: AI_ENABLED,
      lastSeenAt: null,
      lastPreview: AI_ENABLED ? "Ask anything in Arabic or English" : "AI setup required"
    });
    result.sort((a, b) => Number(b.isAI) - Number(a.isAI) || Number(b.isSelf) - Number(a.isSelf) || a.username.localeCompare(b.username));
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load users." });
  }
});

app.get("/api/conversations/archived", auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("conversation_preferences")
      .select("other_user_id").eq("user_id", req.currentUser.id).not("archived_at", "is", null);
    if (error) throw error;
    res.json({ userIds: (data || []).map(row => Number(row.other_user_id)) });
  } catch (error) {
    console.error("Archived conversations failed:", error);
    res.status(500).json({ error: "Archived chats are unavailable. Run v6.3-conversation-controls-migration.sql once." });
  }
});

app.post("/api/conversations/:otherId/archive", auth, async (req, res) => {
  try {
    const otherId = Number(req.params.otherId);
    if (!Number.isSafeInteger(otherId) || otherId <= 0 || otherId === Number(req.currentUser.id)) {
      return res.status(400).json({ error: "Choose another approved user to archive." });
    }
    const other = await getUserById(otherId, "id,status");
    if (!other || other.status !== "approved") return res.status(404).json({ error: "Approved user not found." });
    const { error } = await supabase.from("conversation_preferences").upsert({
      user_id: req.currentUser.id,
      other_user_id: otherId,
      archived_at: new Date().toISOString()
    }, { onConflict: "user_id,other_user_id" });
    if (error) throw error;
    res.json({ ok: true, archived: true });
  } catch (error) {
    console.error("Archive conversation failed:", error);
    res.status(500).json({ error: "The chat could not be archived. Run v6.3-conversation-controls-migration.sql once." });
  }
});

app.delete("/api/conversations/:otherId/archive", auth, async (req, res) => {
  try {
    const otherId = Number(req.params.otherId);
    if (!Number.isSafeInteger(otherId) || otherId <= 0) return res.status(400).json({ error: "Invalid conversation." });
    const { error } = await supabase.from("conversation_preferences")
      .delete().eq("user_id", req.currentUser.id).eq("other_user_id", otherId);
    if (error) throw error;
    res.json({ ok: true, archived: false });
  } catch (error) {
    console.error("Restore conversation failed:", error);
    res.status(500).json({ error: "The chat could not be restored. Run v6.3-conversation-controls-migration.sql once." });
  }
});

app.delete("/api/conversations/:otherId", auth, async (req, res) => {
  try {
    const userId = Number(req.currentUser.id);
    const otherId = Number(req.params.otherId);
    if (!Number.isSafeInteger(otherId) || otherId <= 0) return res.status(400).json({ error: "Invalid conversation." });
    if (req.body?.confirm !== "DELETE ALL") return res.status(400).json({ error: "Conversation deletion was not confirmed." });
    const filter = `and(sender_id.eq.${userId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${userId})`;
    const messages = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: page, error: findError } = await supabase.from("messages")
        .select("id,file_url").or(filter).order("id", { ascending: true }).range(offset, offset + 999);
      if (findError) throw findError;
      messages.push(...(page || []));
      if ((page || []).length < 1000) break;
    }
    const storagePaths = [...new Set(messages.map(message => message.file_url).filter(Boolean))];
    for (let index = 0; index < storagePaths.length; index += 100) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths.slice(index, index + 100));
      if (storageError) throw storageError;
    }
    const { error: deleteError } = await supabase.from("messages").delete().or(filter);
    if (deleteError) throw deleteError;
    await supabase.from("conversation_preferences").delete()
      .or(`and(user_id.eq.${userId},other_user_id.eq.${otherId}),and(user_id.eq.${otherId},other_user_id.eq.${userId})`);
    io.to(`user:${userId}`).to(`user:${otherId}`).emit("conversation:cleared", { userId, otherId });
    res.json({ ok: true, deletedCount: messages.length });
  } catch (error) {
    console.error("Delete conversation failed:", error);
    res.status(500).json({ error: "The conversation or one of its attachments could not be deleted." });
  }
});

app.get("/api/message-media/:messageId", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const messageId = Number(req.params.messageId);
    if (!Number.isSafeInteger(messageId) || messageId <= 0) return res.status(400).end();
    const { data: message, error } = await supabase.from("messages")
      .select("id,sender_id,receiver_id,file_url,file_name,mime_type")
      .eq("id", messageId).maybeSingle();
    if (error) throw error;
    if (!message || (Number(message.sender_id) !== userId && Number(message.receiver_id) !== userId)) return res.status(404).end();
    if (!message.file_url) return res.status(404).end();
    const { data, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(message.file_url);
    if (downloadError || !data) throw downloadError || new Error("Media download failed.");
    const buffer = Buffer.from(await data.arrayBuffer());
    const total = buffer.length;
    const mime = message.mime_type || "application/octet-stream";
    const safeName = cleanFileName(message.file_name || `media-${message.id}`);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `inline; filename=\"${safeName.replace(/\"/g, "")}\"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Accept-Ranges", "bytes");
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [a,b] = range.slice(6).split("-");
      let start, end;
      if (!a && b) {
        // Suffix-byte range (for example bytes=-500) is commonly used by
        // browsers to read media metadata from the end of a file.
        const suffix = Number(b);
        if (!Number.isFinite(suffix) || suffix <= 0 || total === 0) return res.status(416).end();
        start = Math.max(0, total - suffix);
        end = total - 1;
      } else {
        start = Number(a || 0);
        end = b ? Number(b) : total - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || start > end || total === 0) return res.status(416).end();
        end = Math.min(end, total - 1);
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", end-start+1);
      return res.end(buffer.subarray(start,end+1));
    }
    res.setHeader("Content-Length", total);
    res.end(buffer);
  } catch (error) {
    console.error("Message media proxy failed:", error?.message || error);
    res.status(404).end();
  }
});

app.get("/api/messages/:userId", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const otherId = Number(req.params.userId);
    if (!otherId) return res.status(400).json({ error: "Invalid user." });
    const otherUser = await getUserById(otherId, "id,status");
    if (!otherUser || otherUser.status !== "approved") return res.status(404).json({ error: "Approved user not found." });
    const { data, error } = await supabase.from("messages")
      .select("id,sender_id,receiver_id,kind,body,file_url,file_name,mime_type,delivered_at,read_at,created_at")
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${userId})`)
      .order("id", { ascending: false }).limit(1000);
    if (error) throw error;
    const senderIds = [...new Set((data || []).map(message => Number(message.sender_id)))];
    const { data: senders, error: senderError } = senderIds.length
      ? await supabase.from("users").select("id,username").in("id", senderIds)
      : { data: [], error: null };
    if (senderError) throw senderError;
    const names = new Map((senders || []).map(user => [Number(user.id), user.username]));
    const readAt = new Date().toISOString();
    const incomingUnread = (data || []).filter(message => Number(message.receiver_id) === userId && !message.read_at);
    const undeliveredIds = incomingUnread.filter(message => !message.delivered_at).map(message => Number(message.id));
    const unreadIds = incomingUnread.map(message => Number(message.id));
    if (undeliveredIds.length) {
      const { error: deliveredError } = await supabase.from("messages").update({ delivered_at: readAt }).in("id", undeliveredIds);
      if (deliveredError) throw deliveredError;
    }
    if (unreadIds.length) {
      const { error: readError } = await supabase.from("messages").update({ read_at: readAt }).in("id", unreadIds);
      if (readError) throw readError;
      for (const message of incomingUnread) {
        message.delivered_at ||= readAt;
        message.read_at = readAt;
        emitMessageStatus(message);
      }
    }
    const messages = (data || []).reverse().map(message => ({ ...message, sender_name: names.get(Number(message.sender_id)) || "User" }));
    res.json(await signedMessages(messages));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load messages." });
  }
});

app.delete("/api/messages/:messageId", auth, async (req, res) => {
  try {
    const messageId = Number(req.params.messageId);
    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      return res.status(400).json({ error: "Invalid message." });
    }

    const { data: message, error: findError } = await supabase.from("messages")
      .select("id,sender_id,receiver_id,file_url")
      .eq("id", messageId).maybeSingle();
    if (findError) throw findError;
    if (!message) return res.status(404).json({ error: "Message not found." });

    const currentUserId = Number(req.currentUser.id);
    if (Number(message.sender_id) !== currentUserId && !req.currentUser.is_admin) {
      return res.status(403).json({ error: "You can delete only messages that you sent." });
    }

    // Remove the private storage object before deleting its database record so
    // a successful response never leaves a billable orphaned attachment.
    if (message.file_url) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([message.file_url]);
      if (storageError) throw storageError;
    }

    const { data: deleted, error: deleteError } = await supabase.from("messages")
      .delete().eq("id", messageId).select("id").maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) return res.status(404).json({ error: "Message was already deleted." });

    const event = {
      messageId,
      senderId: Number(message.sender_id),
      receiverId: Number(message.receiver_id)
    };
    io.to(`user:${event.senderId}`).to(`user:${event.receiverId}`).emit("message:deleted", event);
    res.json({ ok: true, ...event });
  } catch (error) {
    console.error("Message deletion failed:", error);
    res.status(500).json({ error: "Message or attachment could not be deleted." });
  }
});

app.get("/api/statuses", auth, async (req, res) => {
  try {
    await cleanupExpiredStatuses();
    const now = new Date().toISOString();
    const { data: statuses, error: statusError } = await supabase.from("user_statuses")
      .select("id,user_id,kind,body,file_url,file_name,mime_type,created_at,expires_at")
      .gt("expires_at", now).order("created_at", { ascending: false }).limit(200);
    if (statusError) throw statusError;
    const statusIds = (statuses || []).map(status => Number(status.id));
    const userIds = [...new Set((statuses || []).map(status => Number(status.user_id)))];
    const [{ data: statusUsers, error: userError }, viewResult] = await Promise.all([
      userIds.length
        ? supabase.from("users").select("id,username,avatar").in("id", userIds).eq("status", "approved")
        : Promise.resolve({ data: [], error: null }),
      statusIds.length
        ? supabase.from("status_views").select("status_id,viewer_id").in("status_id", statusIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (userError) throw userError;
    if (viewResult.error) throw viewResult.error;
    const names = new Map((statusUsers || []).map(user => [Number(user.id), user.username]));
    const avatars = new Map((statusUsers || []).map(user => [Number(user.id), avatarProxyUrl(user.id, user.avatar)]));
    const approvedIds = new Set(names.keys());
    const viewerId = Number(req.currentUser.id);
    const viewed = new Set((viewResult.data || []).filter(row => Number(row.viewer_id) === viewerId).map(row => Number(row.status_id)));
    const viewCounts = new Map();
    for (const row of viewResult.data || []) {
      const id = Number(row.status_id);
      viewCounts.set(id, (viewCounts.get(id) || 0) + 1);
    }
    const result = await Promise.all((statuses || []).filter(status => approvedIds.has(Number(status.user_id))).map(async status => {
      const userId = Number(status.user_id);
      const isOwn = userId === viewerId;
      return signedStatus({
        ...status,
        user_id: userId,
        username: names.get(userId) || "User",
        avatar: avatars.get(userId) || null,
        isOwn,
        viewed: isOwn || viewed.has(Number(status.id)),
        viewCount: isOwn ? (viewCounts.get(Number(status.id)) || 0) : undefined
      });
    }));
    res.json(result);
  } catch (error) {
    console.error("Could not load statuses:", error);
    res.status(500).json({ error: "Could not load statuses." });
  }
});

app.post("/api/statuses/text", statusLimiter, auth, async (req, res) => {
  try {
    const body = cleanText(req.body.body, 500);
    if (!body) return res.status(400).json({ error: "Enter status text." });
    const expiresAt = new Date(Date.now() + STATUS_LIFETIME_MS).toISOString();
    const { data: status, error } = await supabase.from("user_statuses").insert({
      user_id: req.currentUser.id,
      kind: "text",
      body,
      expires_at: expiresAt
    }).select("id,user_id,kind,body,file_url,file_name,mime_type,created_at,expires_at").single();
    if (error) throw error;
    io.emit("status:changed", { userId: Number(req.currentUser.id) });
    res.status(201).json({ ...status, username: req.currentUser.username, isOwn: true, viewed: true, viewCount: 0 });
  } catch (error) {
    console.error("Could not post text status:", error);
    res.status(500).json({ error: "Status could not be posted." });
  }
});

app.post("/api/statuses/upload", statusLimiter, auth, upload.single("statusFile"), async (req, res) => {
  let storagePath;
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a photo or video." });
    const verified = await verifyUpload(req.file);
    const kind = verified.mime.startsWith("image/") ? "image" : (verified.mime.startsWith("video/") ? "video" : null);
    if (!kind) return res.status(400).json({ error: "Status supports photos and videos only." });
    const extension = verified.ext ? `.${verified.ext}` : "";
    storagePath = `statuses/${req.currentUser.id}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: verified.mime,
      cacheControl: "900",
      upsert: false
    });
    if (uploadError) throw uploadError;
    const expiresAt = new Date(Date.now() + STATUS_LIFETIME_MS).toISOString();
    const { data: status, error } = await supabase.from("user_statuses").insert({
      user_id: req.currentUser.id,
      kind,
      body: cleanText(req.body.caption, 300),
      file_url: storagePath,
      file_name: cleanFileName(req.file.originalname),
      mime_type: verified.mime,
      expires_at: expiresAt
    }).select("id,user_id,kind,body,file_url,file_name,mime_type,created_at,expires_at").single();
    if (error) throw error;
    io.emit("status:changed", { userId: Number(req.currentUser.id) });
    res.status(201).json(await signedStatus({ ...status, username: req.currentUser.username, isOwn: true, viewed: true, viewCount: 0 }));
  } catch (error) {
    if (storagePath) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    console.error("Could not post media status:", error);
    res.status(400).json({ error: "Photo or video status could not be posted." });
  }
});

app.post("/api/statuses/:statusId/view", auth, async (req, res) => {
  try {
    const statusId = Number(req.params.statusId);
    if (!Number.isSafeInteger(statusId) || statusId <= 0) return res.status(400).json({ error: "Invalid status." });
    const { data: status, error: findError } = await supabase.from("user_statuses")
      .select("id,user_id,expires_at").eq("id", statusId).maybeSingle();
    if (findError) throw findError;
    if (!status || new Date(status.expires_at).getTime() <= Date.now()) return res.status(404).json({ error: "Status expired." });
    const viewerId = Number(req.currentUser.id);
    if (Number(status.user_id) !== viewerId) {
      const { error } = await supabase.from("status_views").upsert({ status_id: statusId, viewer_id: viewerId }, {
        onConflict: "status_id,viewer_id",
        ignoreDuplicates: true
      });
      if (error) throw error;
      io.to(`user:${Number(status.user_id)}`).emit("status:viewed", { statusId });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Could not mark status viewed:", error);
    res.status(500).json({ error: "Status view could not be saved." });
  }
});

app.delete("/api/statuses/:statusId", auth, async (req, res) => {
  try {
    const statusId = Number(req.params.statusId);
    if (!Number.isSafeInteger(statusId) || statusId <= 0) return res.status(400).json({ error: "Invalid status." });
    const { data: status, error: findError } = await supabase.from("user_statuses")
      .select("id,user_id,file_url").eq("id", statusId).maybeSingle();
    if (findError) throw findError;
    if (!status) return res.status(404).json({ error: "Status not found." });
    if (Number(status.user_id) !== Number(req.currentUser.id) && !req.currentUser.is_admin) {
      return res.status(403).json({ error: "You cannot delete this status." });
    }
    if (status.file_url) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([status.file_url]);
      if (storageError) throw storageError;
    }
    const { error: deleteError } = await supabase.from("user_statuses").delete().eq("id", statusId);
    if (deleteError) throw deleteError;
    io.emit("status:deleted", { statusId, userId: Number(status.user_id) });
    res.json({ ok: true });
  } catch (error) {
    console.error("Could not delete status:", error);
    res.status(500).json({ error: "Status could not be deleted." });
  }
});

const recentMediaUploads = new Map();
function cleanupRecentMediaUploads() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of recentMediaUploads) if (value.createdAt < cutoff) recentMediaUploads.delete(key);
}

app.post("/api/upload", auth, upload.single("file"), async (req, res) => {
  let storagePath;
  try {
    const receiverId = Number(req.body.receiverId);
    if (!req.file || !receiverId) return res.status(400).json({ error: "Missing file or receiver." });
    const receiver = await getUserById(receiverId, "id,status");
    if (!receiver || receiver.status !== "approved") return res.status(404).json({ error: "Approved receiver not found." });
    cleanupRecentMediaUploads();
    const uploadId = cleanText(req.body.uploadId, 100);
    const uploadKey = uploadId ? `${Number(req.session.userId)}:${receiverId}:${uploadId}` : null;
    if (uploadKey && recentMediaUploads.has(uploadKey)) return res.json(recentMediaUploads.get(uploadKey).message);

    const requestedKind = ["image", "voice", "video", "file"].includes(req.body.kind) ? req.body.kind : "file";

    // Build 6768: do not transcode every video before it can be sent.
    // The browser preview already proves that most recordings are valid media.
    // For video we first verify and store the original bytes immediately. This
    // avoids slow ffmpeg transcoding on Render blocking even a short recording.
    // ffmpeg is now only a fallback for Safari/iPhone fragmented MP4 that the
    // strict file signature detector cannot identify. Voice keeps normalization
    // because it has been reliable and gives consistent M4A playback.
    let stored = null;
    if (requestedKind === "video") {
      // Build 6768: the same Blob that plays in Preview must be the Blob sent.
      // Do not reject browser MediaRecorder output just because a signature
      // library cannot classify it. Safari/Chrome can produce fragmented MP4
      // or WebM variants that are valid/playable but not detected reliably.
      if (!req.file?.buffer || req.file.buffer.length < 1024) throw new Error("The video recording is empty.");
      const declaredMime = String(req.file.mimetype || "").split(";")[0].trim().toLowerCase();
      const declaredVideoTypes = {
        "video/webm": { mime: "video/webm", ext: "webm" },
        "video/mp4": { mime: "video/mp4", ext: "mp4" },
        "video/quicktime": { mime: "video/quicktime", ext: "mov" }
      };
      let videoType = declaredVideoTypes[declaredMime] || basicRecordedVideoSignature(req.file.buffer);
      if (!videoType) {
        // Last fallback: try normal detection, but do not transcode.
        try {
          const verified = await verifyUpload(req.file);
          if (verified.kind === "video") videoType = verified;
        } catch {}
      }
      if (!videoType) throw new Error("The recorded video format is not supported.");
      stored = { buffer: req.file.buffer, mime: videoType.mime, ext: videoType.ext, kind: "video" };
    } else if (requestedKind === "voice") {
      stored = await normalizeRecordedMedia(req.file, "voice");
      if (!stored) {
        const verified = await verifyUpload(req.file);
        const kindMatches = verified.kind === "voice" || (verified.kind === "video" && req.file.mimetype === "audio/webm");
        if (!kindMatches) throw new Error("The recorded media type could not be verified.");
        stored = { buffer: req.file.buffer, mime: verified.mime, ext: verified.ext, kind: "voice" };
      }
    } else {
      const verified = await verifyUpload(req.file);
      stored = { buffer: req.file.buffer, mime: verified.mime, ext: verified.ext, kind: requestedKind === "file" ? verified.kind : requestedKind };
    }
    const extension = stored.ext ? `.${stored.ext}` : "";
    storagePath = `${req.session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, stored.buffer, {
      contentType: stored.mime,
      cacheControl: "900",
      upsert: false
    });
    if (uploadError) throw uploadError;
    const receiptTime = new Date().toISOString();
    const deliveredAt = receiverId === Number(req.session.userId) || onlineUsers.has(receiverId) ? receiptTime : null;
    const readAt = receiverId === Number(req.session.userId) ? receiptTime : null;
    const { data: message, error } = await supabase.from("messages").insert({
      sender_id: req.session.userId,
      receiver_id: receiverId,
      kind: stored.kind,
      body: cleanText(req.body.caption, 500),
      file_url: storagePath,
      file_name: cleanFileName(`${path.parse(req.file.originalname || "media").name}.${stored.ext || path.extname(req.file.originalname || "").replace(/^\./, "") || "bin"}`),
      mime_type: stored.mime,
      delivered_at: deliveredAt,
      read_at: readAt
    }).select("id,sender_id,receiver_id,kind,body,file_url,file_name,mime_type,delivered_at,read_at,created_at").single();
    if (error) throw error;
    const outgoing = await signedMessage({ ...message, sender_name: req.session.username });
    if (uploadKey) recentMediaUploads.set(uploadKey, { createdAt: Date.now(), message: outgoing });
    io.to(`user:${req.session.userId}`).to(`user:${receiverId}`).emit("privateMessage", outgoing);
    res.json(outgoing);
  } catch (error) {
    if (storagePath) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    console.error(error);
    const safeMessages = new Set([
      "The file content does not match an allowed type.",
      "This file type is not allowed.",
      "Text files must use UTF-8 encoding.",
      "The recorded media type could not be verified.",
      "The recorded video could not be verified.",
      "The recorded video format is not supported.",
      "The video recording is empty."
    ]);
    res.status(400).json({ error: safeMessages.has(error.message) ? error.message : "Upload failed." });
  }
});

io.on("connection", async socket => {
  const sess = socket.request.session;
  if (!sess || !sess.userId) return socket.disconnect(true);
  const userId = Number(sess.userId);
  let socketUser;
  try {
    socketUser = await getUserById(userId, "id,username,status");
  } catch (error) {
    console.error("Socket account verification failed:", error);
    return socket.disconnect(true);
  }
  if (!socketUser || socketUser.status !== "approved") return socket.disconnect(true);
  const username = socketUser.username;
  socket.data.userId = userId;
  socket.data.username = username;
  socket.join(`user:${userId}`);
  try {
    const [{ data: gm }, { data: cm }] = await Promise.all([
      supabase.from("group_members").select("group_id").eq("user_id", userId),
      supabase.from("channel_members").select("channel_id").eq("user_id", userId)
    ]);
    (gm || []).forEach(x => socket.join(`group:${x.group_id}`));
    (cm || []).forEach(x => socket.join(`channel:${x.channel_id}`));
  } catch (error) {
    console.error("Could not join collaboration rooms:", error.message);
  }
  addOnlineSocket(userId, socket.id);
  io.emit("presence", { userId, online: true });
  socket.emit("presence:snapshot", { userIds: [...onlineUsers.keys()] });
  markPendingMessagesDelivered(userId).catch(error => console.error("Could not mark pending messages delivered:", error));
  try {
    const { data: missedCalls, error: missedError } = await supabase.from("call_logs")
      .select("id,caller_id,mode,started_at")
      .eq("receiver_id", userId).eq("status", "missed").is("ended_at", null)
      .order("started_at", { ascending: true }).limit(20);
    if (missedError) throw missedError;
    const callerIds = [...new Set((missedCalls || []).map(call => Number(call.caller_id)))];
    const { data: callers, error: callerError } = callerIds.length
      ? await supabase.from("users").select("id,username").in("id", callerIds)
      : { data: [], error: null };
    if (callerError) throw callerError;
    const callerNames = new Map((callers || []).map(caller => [Number(caller.id), caller.username]));
    const callIds = (missedCalls || []).map(call => Number(call.id));
    if (callIds.length) {
      const { error: markError } = await supabase.from("call_logs")
        .update({ ended_at: new Date().toISOString() }).in("id", callIds);
      if (markError) throw markError;
      for (const call of missedCalls) {
        socket.emit("call:missed", {
          callId: Number(call.id),
          callerId: Number(call.caller_id),
          callerName: callerNames.get(Number(call.caller_id)) || "ConnectChat user",
          mode: call.mode === "video" ? "video" : "audio",
          startedAt: call.started_at
        });
      }
    }
  } catch (error) {
    console.error("Could not deliver missed-call notifications:", error.message);
  }

  socket.on("privateMessage", async payload => {
    try {
      if (!eventAllowed(socket, "message", 30, 10 * 1000)) {
        return socket.emit("message:error", { error: "You are sending messages too quickly." });
      }
      if (!payload || typeof payload !== "object" || typeof payload.body !== "string" || payload.body.length > 2000) {
        return socket.emit("message:error", { error: "Invalid message." });
      }
      const receiverId = Number(payload.receiverId);
      const body = cleanText(payload.body, 2000);
      if (!Number.isSafeInteger(receiverId) || receiverId <= 0 || !body) return;
      const receiver = await getUserById(receiverId, "id,status");
      if (!receiver || receiver.status !== "approved") return socket.emit("message:error", { error: "Receiver is unavailable." });
      const receiptTime = new Date().toISOString();
      const deliveredAt = receiverId === userId || onlineUsers.has(receiverId) ? receiptTime : null;
      const readAt = receiverId === userId ? receiptTime : null;
      const { data: message, error } = await supabase.from("messages").insert({
        sender_id: userId,
        receiver_id: receiverId,
        kind: "text",
        body,
        delivered_at: deliveredAt,
        read_at: readAt
      }).select("id,sender_id,receiver_id,kind,body,file_url,file_name,mime_type,delivered_at,read_at,created_at").single();
      if (error) throw error;
      io.to(`user:${userId}`).to(`user:${receiverId}`).emit("privateMessage", { ...message, sender_name: username });
      if (!onlineUsers.has(receiverId)) sendPushToUser(receiverId, { type: "message", title: username, body: body.slice(0, 160), tag: `private-${userId}`, url: "/?from="+userId }).catch(()=>{});
    } catch (error) {
      console.error("Message failed:", error);
      socket.emit("message:error", { error: "Message could not be sent." });
    }
  });

  socket.on("message:read", async payload => {
    try {
      if (!eventAllowed(socket, "read", 60, 10 * 1000) || !payload || typeof payload !== "object") return;
      const messageIds = [...new Set((Array.isArray(payload.messageIds) ? payload.messageIds : [])
        .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 100);
      if (!messageIds.length) return;
      const { data: messages, error: findError } = await supabase.from("messages")
        .select("id,sender_id,receiver_id,delivered_at,read_at")
        .in("id", messageIds).eq("receiver_id", userId);
      if (findError) throw findError;
      const unread = (messages || []).filter(message => !message.read_at);
      if (!unread.length) return;
      const readAt = new Date().toISOString();
      const undeliveredIds = unread.filter(message => !message.delivered_at).map(message => Number(message.id));
      if (undeliveredIds.length) {
        const { error } = await supabase.from("messages").update({ delivered_at: readAt }).in("id", undeliveredIds);
        if (error) throw error;
      }
      const { error: readError } = await supabase.from("messages").update({ read_at: readAt }).in("id", unread.map(message => Number(message.id)));
      if (readError) throw readError;
      for (const message of unread) emitMessageStatus({ ...message, delivered_at: message.delivered_at || readAt, read_at: readAt });
    } catch (error) {
      console.error("Could not mark messages read:", error);
    }
  });

  socket.on("typing", payload => {
    if (!eventAllowed(socket, "typing", 25, 10 * 1000) || !payload || typeof payload !== "object") return;
    const receiverId = Number(payload.receiverId);
    if (Number.isSafeInteger(receiverId) && receiverId > 0 && receiverId !== userId && onlineUsers.has(receiverId)) {
      io.to(`user:${receiverId}`).emit("typing", { userId, username, isTyping: payload.isTyping === true });
    }
  });

  socket.on("call:start", async payload => {
    if (!CALLS_ENABLED || !eventAllowed(socket, "call", 10, 60 * 1000) || !payload || typeof payload !== "object") {
      return socket.emit("call:unavailable", {});
    }
    const receiverId = Number(payload.receiverId);
    if (!Number.isSafeInteger(receiverId) || receiverId <= 0 || receiverId === userId
      || !validDescription(payload.offer, "offer")) return socket.emit("call:unavailable", { receiverId });
    if (!onlineUsers.has(receiverId)) {
      try {
        const receiver = await getUserById(receiverId, "id,username,status");
        if (!receiver || receiver.status !== "approved") return socket.emit("call:unavailable", { receiverId });
        const mode = payload.mode === "audio" ? "audio" : "video";
        const { error } = await supabase.from("call_logs").insert({
          caller_id: userId, receiver_id: receiverId, mode, status: "missed"
        });
        if (error) throw error;
        const pushResult = await sendPushToUser(receiverId, { type: "call", title: `Incoming ${mode === "video" ? "video" : "voice"} call`, body: `${username} is calling you`, tag: `incoming-call-${userId}`, url: `/?missedCall=1&callFrom=${userId}&mode=${mode}` });
        return socket.emit("call:queued", { receiverId, receiverName: receiver.username, mode, deliveredNow: Number(pushResult?.sent || 0) > 0 });
      } catch (error) {
        console.error("Could not save missed call:", error);
        return socket.emit("call:unavailable", { receiverId });
      }
    }
    openCallPair(userId, receiverId);
    supabase.from("call_logs").insert({
      caller_id: userId, receiver_id: receiverId,
      mode: payload.mode === "audio" ? "audio" : "video", status: "started"
    }).then(({ error }) => { if (error) console.error("Could not save call history:", error.message); });
    io.to(`user:${receiverId}`).emit("call:incoming", {
      callerId: userId,
      callerName: username,
      mode: payload.mode === "audio" ? "audio" : "video",
      offer: payload.offer
    });
  });

  socket.on("call:notify", async payload => {
    try {
      if (!CALLS_ENABLED || !eventAllowed(socket, "call-notify", 6, 60 * 1000) || !payload || typeof payload !== "object") {
        return socket.emit("call:unavailable", {});
      }
      const receiverId = Number(payload.receiverId);
      if (!Number.isSafeInteger(receiverId) || receiverId <= 0 || receiverId === userId) {
        return socket.emit("call:unavailable", {});
      }
      const receiver = await getUserById(receiverId, "id,username,status");
      if (!receiver || receiver.status !== "approved") return socket.emit("call:unavailable", {});
      const mode = payload.mode === "video" ? "video" : "audio";
      const online = onlineUsers.has(receiverId);
      const notificationTime = online ? new Date().toISOString() : null;
      const { data: callLog, error } = await supabase.from("call_logs").insert({
        caller_id: userId,
        receiver_id: receiverId,
        mode,
        status: "missed",
        ended_at: notificationTime
      }).select("id,started_at").single();
      if (error) throw error;
      if (online) {
        io.to(`user:${receiverId}`).emit("call:missed", {
          callId: Number(callLog.id),
          callerId: userId,
          callerName: username,
          mode,
          startedAt: callLog.started_at
        });
      }
      socket.emit("call:queued", {
        receiverId,
        receiverName: receiver.username,
        mode,
        deliveredNow: online
      });
    } catch (error) {
      console.error("Could not save offline call notification:", error);
      socket.emit("call:unavailable", {});
    }
  });

  socket.on("call:answer", payload => {
    if (!CALLS_ENABLED || !eventAllowed(socket, "call", 40, 60 * 1000) || !payload || typeof payload !== "object") return;
    const receiverId = Number(payload.receiverId);
    if (Number.isSafeInteger(receiverId) && receiverId > 0 && callPairIsOpen(userId, receiverId) && validDescription(payload.answer, "answer")) {
      io.to(`user:${receiverId}`).emit("call:answered", { userId, answer: payload.answer });
    }
  });
  socket.on("call:ice", payload => {
    if (!CALLS_ENABLED || !eventAllowed(socket, "ice", 300, 60 * 1000) || !payload || typeof payload !== "object") return;
    const receiverId = Number(payload.receiverId);
    if (Number.isSafeInteger(receiverId) && receiverId > 0 && callPairIsOpen(userId, receiverId) && validIceCandidate(payload.candidate)) {
      io.to(`user:${receiverId}`).emit("call:ice", { userId, candidate: payload.candidate });
    }
  });
  socket.on("call:filter", payload => {
    if (!CALLS_ENABLED || !payload || typeof payload !== "object") return;
    const receiverId = Number(payload.receiverId);
    const allowed = new Set(["normal","beauty","warm","cool","bw","bright","soft"]);
    const filter = allowed.has(String(payload.filter || "")) ? String(payload.filter) : "normal";
    if (Number.isSafeInteger(receiverId) && receiverId > 0 && callPairIsOpen(userId, receiverId)) {
      io.to(`user:${receiverId}`).emit("call:filter", { userId, filter });
    }
  });
  socket.on("call:reject", payload => {
    if (!payload || typeof payload !== "object") return;
    const receiverId = Number(payload.receiverId);
    if (Number.isSafeInteger(receiverId) && receiverId > 0 && callPairIsOpen(userId, receiverId)) {
      closeCallPair(userId, receiverId);
      io.to(`user:${receiverId}`).emit("call:rejected", { userId });
    }
  });
  socket.on("call:end", payload => {
    if (!payload || typeof payload !== "object") return;
    const receiverId = Number(payload.receiverId);
    if (Number.isSafeInteger(receiverId) && receiverId > 0 && callPairIsOpen(userId, receiverId)) {
      closeCallPair(userId, receiverId);
      io.to(`user:${receiverId}`).emit("call:ended", { userId });
    }
  });

  // Small-group conference signaling. Media remains peer-to-peer; the server
  // only verifies group membership and relays WebRTC descriptions/candidates.
  socket.on("group-call:join", async payload => {
    try {
      if (!CALLS_ENABLED || !eventAllowed(socket, "group-call", 20, 60 * 1000)) return;
      const groupId = Number(payload?.groupId);
      if (!Number.isSafeInteger(groupId) || groupId <= 0 || !(await groupAccess(groupId, userId))) return;
      const room = `group-call:${groupId}`;
      const present = (await io.in(room).fetchSockets())
        .filter(item => Number(item.data.userId) !== userId)
        .map(item => ({ userId: Number(item.data.userId), username: String(item.data.username || "Member") }));
      const unique = [...new Map(present.map(item => [item.userId, item])).values()].slice(0, 5);
      if (unique.length >= 5) return socket.emit("group-call:full", { groupId });
      socket.join(room);
      socket.emit("group-call:participants", { groupId, participants: unique });
      socket.to(room).emit("group-call:participant-joined", { groupId, userId, username });
      if (unique.length === 0) {
        socket.to(`group:${groupId}`).emit("group-call:invite", {
          groupId, callerId: userId, callerName: username,
          mode: payload?.mode === "audio" ? "audio" : "video"
        });
      }
    } catch (error) {
      console.error("Group call join failed:", error.message);
    }
  });
  socket.on("group-call:offer", async payload => {
    try {
      const groupId = Number(payload?.groupId), receiverId = Number(payload?.receiverId);
      if (!CALLS_ENABLED || !Number.isSafeInteger(groupId) || !Number.isSafeInteger(receiverId)
        || !(await groupAccess(groupId, userId)) || !(await groupAccess(groupId, receiverId))
        || !validDescription(payload?.offer, "offer")) return;
      io.to(`user:${receiverId}`).emit("group-call:offer", { groupId, userId, username, offer: payload.offer });
    } catch {}
  });
  socket.on("group-call:answer", async payload => {
    try {
      const groupId = Number(payload?.groupId), receiverId = Number(payload?.receiverId);
      if (!CALLS_ENABLED || !Number.isSafeInteger(groupId) || !Number.isSafeInteger(receiverId)
        || !(await groupAccess(groupId, userId)) || !(await groupAccess(groupId, receiverId))
        || !validDescription(payload?.answer, "answer")) return;
      io.to(`user:${receiverId}`).emit("group-call:answer", { groupId, userId, answer: payload.answer });
    } catch {}
  });
  socket.on("group-call:ice", async payload => {
    try {
      const groupId = Number(payload?.groupId), receiverId = Number(payload?.receiverId);
      if (!CALLS_ENABLED || !Number.isSafeInteger(groupId) || !Number.isSafeInteger(receiverId)
        || !(await groupAccess(groupId, userId)) || !(await groupAccess(groupId, receiverId))
        || !validIceCandidate(payload?.candidate)) return;
      io.to(`user:${receiverId}`).emit("group-call:ice", { groupId, userId, candidate: payload.candidate });
    } catch {}
  });
  socket.on("group-call:leave", payload => {
    const groupId = Number(payload?.groupId);
    if (!Number.isSafeInteger(groupId) || groupId <= 0) return;
    const room = `group-call:${groupId}`;
    socket.leave(room);
    socket.to(room).emit("group-call:participant-left", { groupId, userId });
  });
  socket.on("disconnect", () => {
    closeUserCallPairs(userId);
    if (removeOnlineSocket(userId, socket.id)) {
      const lastSeenAt = new Date().toISOString();
      supabase.from("users").update({ last_seen_at: lastSeenAt }).eq("id", userId)
        .then(({ error }) => { if (error) console.error("Could not update last seen:", error.message); })
        .catch(error => console.error("Could not update last seen:", error));
      io.emit("presence", { userId, online: false, lastSeenAt });
    }
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "File is larger than 12 MB." : "The upload request is invalid.";
    return res.status(400).json({ error: message });
  }
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
  res.status(400).json({ error: "Request failed." });
});

async function start() {
  console.log("Starting ConnectChat Pro with Supabase storage...");
  const { error: databaseError } = await supabase.from("users").select("id,status,is_admin", { head: true, count: "exact" });
  if (databaseError) throw new Error(`Supabase database is not ready: ${databaseError.message}`);
  const { error: sessionTableError } = await supabase.from("app_sessions").select("sid", { head: true, count: "exact" });
  if (sessionTableError) throw new Error("Security migration is required. Run security-migration.sql in the Supabase SQL Editor before deploying this release.");
  const socialChecks = await Promise.all([
    supabase.from("users").select("last_seen_at", { head: true, count: "exact" }),
    supabase.from("messages").select("delivered_at,read_at", { head: true, count: "exact" }),
    supabase.from("user_statuses").select("id", { head: true, count: "exact" }),
    supabase.from("status_views").select("status_id", { head: true, count: "exact" })
  ]);
  if (socialChecks.some(result => result.error)) {
    throw new Error("Social migration is required. Run social-migration.sql in the Supabase SQL Editor before deploying this release.");
  }
  const enterpriseChecks = await Promise.all([
    supabase.from("groups").select("id", { head: true, count: "exact" }),
    supabase.from("group_members").select("group_id", { head: true, count: "exact" }),
    supabase.from("group_messages").select("id", { head: true, count: "exact" }),
    supabase.from("channels").select("id", { head: true, count: "exact" }),
    supabase.from("channel_posts").select("id", { head: true, count: "exact" }),
    supabase.from("call_logs").select("id", { head: true, count: "exact" })
  ]);
  if (enterpriseChecks.some(result => result.error)) {
    throw new Error("Enterprise v5 migration is required. Run enterprise-v5-migration.sql in Supabase SQL Editor.");
  }
  const { error: cleanupError } = await supabase.from("app_sessions").delete().lt("expires_at", new Date().toISOString());
  if (cleanupError) console.error("Could not clean expired sessions:", cleanupError.message);
  const { data: bucket, error: bucketError } = await supabase.storage.getBucket(STORAGE_BUCKET);
  if (bucketError && !String(bucketError.message).toLowerCase().includes("not found")) throw bucketError;
  if (!bucket) {
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.storage.updateBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes
    });
    if (error) throw error;
  }
  await cleanupExpiredStatuses();
  server.listen(PORT, "0.0.0.0", () => console.log(`ConnectChat Pro is running at http://localhost:${PORT}`));
}

function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10 * 1000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch(error => {
  console.error(error);
  process.exit(1);
});
