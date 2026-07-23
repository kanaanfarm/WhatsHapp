require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
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

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || "connectchat-files";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = String(process.env.SESSION_SECRET || "");
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
const PASSWORD_MIN_LENGTH = 10;
const BCRYPT_ROUNDS = 12;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const SIGNED_URL_SECONDS = 15 * 60;
const AVATAR_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;
const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CALLS_ENABLED = process.env.CALLS_ENABLED !== "false";
const AI_PROVIDER = String(process.env.AI_PROVIDER || "openai").trim().toLowerCase();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
const OLLAMA_URL = String(process.env.OLLAMA_URL || (AI_PROVIDER === "ollama" ? "http://127.0.0.1:11434" : "")).trim().replace(/\/$/, "");
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || "qwen2.5:7b").trim();
const AI_DEFAULT_PROVIDER = String(process.env.AI_DEFAULT_PROVIDER || "ollama").trim().toLowerCase() === "openai" ? "openai" : "ollama";
const AI_REQUEST_TIMEOUT_MS = Math.min(Math.max(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 60000, 10000), 180000);
const AI_AUTO_FALLBACK_TIMEOUT_MS = Math.min(Math.max(Number(process.env.AI_AUTO_FALLBACK_TIMEOUT_MS) || 12000, 5000), 30000);
const OPENAI_CONFIGURED = Boolean(OPENAI_API_KEY && OPENAI_MODEL);
const OLLAMA_CONFIGURED = Boolean(OLLAMA_URL && OLLAMA_MODEL && !/example\.com|replace-me|your-secured/i.test(OLLAMA_URL));
const AI_CONFIGURED = AI_PROVIDER === "hybrid"
  ? OPENAI_CONFIGURED || OLLAMA_CONFIGURED
  : AI_PROVIDER === "ollama" ? OLLAMA_CONFIGURED : OPENAI_CONFIGURED;
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
    status: row.status || "approved",
    isAdmin: Boolean(row.is_admin)
  };
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

async function signedAvatarUrl(storagePath) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, AVATAR_SIGNED_URL_SECONDS);
  if (error) {
    console.error("Could not sign avatar URL:", error.message);
    return null;
  }
  return data?.signedUrl || null;
}

async function safeUserWithAvatar(row) {
  const user = safeUser(row);
  user.avatar = await signedAvatarUrl(row?.avatar);
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
  const kind = mime.startsWith("image/") ? "image" : (mime.startsWith("audio/") ? "voice" : "file");
  return { mime, ext: detected.ext.replace(/[^a-z0-9]/gi, "").slice(0, 10), kind };
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
    const username = cleanText(req.body.username, 30);
    const password = String(req.body.password || "");
    const { data: user, error } = await supabase.from("users").select("id,username,avatar,password_hash,status,is_admin").eq("username", username).maybeSingle();
    if (error) throw error;
    const passwordMatches = password.length <= 128 && await bcrypt.compare(password, user?.password_hash || dummyPasswordHash);
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    if (user.status !== "approved") {
      return res.status(403).json({
        error: user.status === "blocked" ? "This account has been blocked by the administrator." : "Your account is waiting for administrator approval.",
        code: String(user.status || "pending").toUpperCase()
      });
    }
    const responseUser = await safeUserWithAvatar(user);
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
    res.json(await safeUserWithAvatar(user));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load account." });
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
    const avatar = await signedAvatarUrl(storagePath);
    io.emit("users:changed");
    res.json({ ok: true, avatar });
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
    io.emit("users:changed");
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not remove profile photo." });
  }
});

app.get("/api/health", async (_, res) => {
  const { error } = await supabase.from("users").select("id", { head: true, count: "exact" });
  res.status(error ? 503 : 200).json({ ok: !error });
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
  const activeProvider = AI_PROVIDER === "hybrid" ? "Hybrid" : AI_PROVIDER === "ollama" ? "Ollama" : "OpenAI";
  return {
    enabled: AI_ENABLED,
    mode: AI_PROVIDER,
    provider: activeProvider,
    model: AI_PROVIDER === "hybrid" ? "Automatic selection" : AI_PROVIDER === "ollama" ? OLLAMA_MODEL : OPENAI_MODEL,
    defaultProvider: AI_DEFAULT_PROVIDER,
    configured: AI_CONFIGURED,
    providers: {
      openai: { available: OPENAI_CONFIGURED, label: "OpenAI", model: OPENAI_MODEL },
      ollama: { available: OLLAMA_CONFIGURED, label: "Ollama", model: OLLAMA_MODEL }
    },
    autoFallbackSeconds: Math.round(AI_AUTO_FALLBACK_TIMEOUT_MS / 1000)
  };
}

function aiFailureText(provider, error) {
  const label = provider === "ollama" ? "Ollama" : "OpenAI";
  if (error?.name === "AbortError") return `${label} timed out`;
  if (error?.status === 401) return `${label} rejected its credentials`;
  if (error?.status === 429) return `${label} quota or rate limit reached`;
  if (provider === "ollama") return "Ollama server is unreachable";
  return "OpenAI request failed";
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

app.get("/api/ai/status", auth, (req, res) => res.json(aiPublicStatus()));

app.post("/api/ai/chat", aiLimiter, auth, async (req, res) => {
  try {
    if (!AI_ENABLED) {
      return res.status(503).json({
        error: "ConnectChat AI is not configured. Check the OpenAI or Ollama server settings."
      });
    }
    const message = cleanText(req.body?.message, 4000);
    if (!message) return res.status(400).json({ error: "Please enter a message." });
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];
    const history = rawHistory.map(item => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: cleanText(item?.content, 4000)
    })).filter(item => item.content);
    const requested = ["auto", "openai", "ollama"].includes(req.body?.provider) ? req.body.provider : "auto";
    const allowed = AI_PROVIDER === "hybrid" ? ["openai", "ollama"] : [AI_PROVIDER === "ollama" ? "ollama" : "openai"];
    const available = allowed.filter(provider => provider === "openai" ? OPENAI_CONFIGURED : OLLAMA_CONFIGURED);
    let queue;
    if (requested !== "auto") {
      if (!allowed.includes(requested)) return res.status(400).json({ error: `${requested === "openai" ? "OpenAI" : "Ollama"} is disabled by the server administrator.` });
      if (!available.includes(requested)) return res.status(503).json({ error: `${requested === "openai" ? "OpenAI" : "Ollama"} is not configured on the server.` });
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
      provider: usedProvider === "ollama" ? "Ollama" : "OpenAI",
      model: usedProvider === "ollama" ? OLLAMA_MODEL : OPENAI_MODEL,
      fallbackUsed: requested === "auto" && queue[0] !== usedProvider,
      status: aiPublicStatus()
    });
  } catch (error) {
    if (error?.name === "AbortError") return res.status(504).json({ error: "ConnectChat AI took too long to respond." });
    console.error("AI chat failed:", error);
    if (error?.status === 401) return res.status(502).json({ error: "The AI provider rejected its API key." });
    if (error?.status === 429) return res.status(429).json({ error: "AI usage limit reached. Please try again shortly." });
    res.status(502).json({ error: "No AI provider could answer. Check the OpenAI key and confirm that the Ollama server is reachable." });
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
    const rows = [{ group_id: group.id, user_id: ownerId, role: "owner" },
      ...memberIds.map(user_id => ({ group_id: group.id, user_id, role: "member" }))];
    const { error: memberError } = await supabase.from("group_members").insert(rows);
    if (memberError) throw memberError;
    res.status(201).json({ ...group, role: "owner" });
  } catch (error) {
    console.error("Create group failed:", error);
    res.status(500).json({ error: "Group could not be created." });
  }
});

app.get("/api/groups/:groupId/messages", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId), userId = Number(req.session.userId);
    if (!Number.isSafeInteger(groupId) || !(await groupAccess(groupId, userId))) return res.status(403).json({ error: "Access denied." });
    const { data, error } = await supabase.from("group_messages")
      .select("id,group_id,sender_id,body,created_at,users!group_messages_sender_id_fkey(username,avatar_url)")
      .eq("group_id", groupId).order("created_at", { ascending: true }).limit(500);
    if (error) throw error;
    res.json((data || []).map(m => ({ ...m, sender_name: m.users?.username || "User", avatar_url: m.users?.avatar_url || null, users: undefined })));
  } catch (error) {
    console.error("Group messages failed:", error);
    res.status(500).json({ error: "Group messages could not be loaded." });
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
      ? await supabase.from("users").select("id,username,avatar_url").in("id", userIds)
      : { data: [], error: null };
    if (peopleError) throw peopleError;
    const peopleMap = new Map((people || []).map(x => [Number(x.id), x]));
    res.json((data || []).map(x => ({ ...x, caller: peopleMap.get(Number(x.caller_id)), receiver: peopleMap.get(Number(x.receiver_id)) })));
  } catch (error) {
    console.error("Call history failed:", error);
    res.status(500).json({ error: "Call history could not be loaded. Run enterprise-v5-migration.sql." });
  }
});

const calculationSheetMimeTypes = new Set([
  "application/pdf", "text/csv", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

async function calculationSheetView(row, usernames = new Map()) {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  if (error) console.error("Could not sign calculation sheet:", error.message);
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
    downloadUrl: data?.signedUrl || null
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
      ? await supabase.from("users").select("id,username").in("id", ids)
      : { data: [], error: null };
    if (peopleError) throw peopleError;
    const usernames = new Map((people || []).map(person => [Number(person.id), person.username]));
    res.json(await Promise.all(visibleSheets.map(row => calculationSheetView(row, usernames))));
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
    res.json(await calculationSheetView(row, new Map([[Number(req.currentUser.id), req.currentUser.username]])));
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
        avatar: await signedAvatarUrl(user.avatar),
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
        ? supabase.from("users").select("id,username").in("id", userIds).eq("status", "approved")
        : Promise.resolve({ data: [], error: null }),
      statusIds.length
        ? supabase.from("status_views").select("status_id,viewer_id").in("status_id", statusIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (userError) throw userError;
    if (viewResult.error) throw viewResult.error;
    const names = new Map((statusUsers || []).map(user => [Number(user.id), user.username]));
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

app.post("/api/upload", auth, upload.single("file"), async (req, res) => {
  let storagePath;
  try {
    const receiverId = Number(req.body.receiverId);
    if (!req.file || !receiverId) return res.status(400).json({ error: "Missing file or receiver." });
    const receiver = await getUserById(receiverId, "id,status");
    if (!receiver || receiver.status !== "approved") return res.status(404).json({ error: "Approved receiver not found." });
    const verified = await verifyUpload(req.file);
    const extension = verified.ext ? `.${verified.ext}` : "";
    storagePath = `${req.session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: verified.mime,
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
      kind: verified.kind,
      body: cleanText(req.body.caption, 500),
      file_url: storagePath,
      file_name: cleanFileName(req.file.originalname),
      mime_type: verified.mime,
      delivered_at: deliveredAt,
      read_at: readAt
    }).select("id,sender_id,receiver_id,kind,body,file_url,file_name,mime_type,delivered_at,read_at,created_at").single();
    if (error) throw error;
    const outgoing = await signedMessage({ ...message, sender_name: req.session.username });
    io.to(`user:${req.session.userId}`).to(`user:${receiverId}`).emit("privateMessage", outgoing);
    res.json(outgoing);
  } catch (error) {
    if (storagePath) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    console.error(error);
    const safeMessages = new Set([
      "The file content does not match an allowed type.",
      "This file type is not allowed.",
      "Text files must use UTF-8 encoding."
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

  socket.on("call:start", payload => {
    if (!CALLS_ENABLED || !eventAllowed(socket, "call", 10, 60 * 1000) || !payload || typeof payload !== "object") {
      return socket.emit("call:unavailable", {});
    }
    const receiverId = Number(payload.receiverId);
    if (!Number.isSafeInteger(receiverId) || receiverId <= 0 || receiverId === userId || !onlineUsers.has(receiverId)
      || !validDescription(payload.offer, "offer")) return socket.emit("call:unavailable", { receiverId });
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
