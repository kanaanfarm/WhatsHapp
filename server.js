const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || "connectchat-files";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = String(process.env.SESSION_SECRET || "");
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
const PASSWORD_MIN_LENGTH = 10;
const BCRYPT_ROUNDS = 12;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const SIGNED_URL_SECONDS = 15 * 60;
const CALLS_ENABLED = process.env.CALLS_ENABLED !== "false";
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PRODUCTION,
  path: "/"
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
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
  "audio/webm", "video/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav",
  "application/pdf", "text/plain",
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 3, parts: 4 }
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
    if (file.mimetype !== "text/plain" || file.buffer.includes(0)) throw new Error("The file content does not match an allowed type.");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(file.buffer);
      return { mime: "text/plain", ext: "txt", kind: "file" };
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
    req.session.regenerate(regenerateError => {
      if (regenerateError) return res.status(500).json({ error: "Login failed." });
      req.session.userId = Number(user.id);
      req.session.username = user.username;
      req.session.save(saveError => {
        if (saveError) return res.status(500).json({ error: "Login failed." });
        res.json(safeUser(user));
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
    res.json(safeUser(user));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load account." });
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

    const { data: files, error: fileError } = await supabase.from("messages")
      .select("file_url")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .not("file_url", "is", null);
    if (fileError) throw fileError;
    const storagePaths = [...new Set((files || []).map(row => row.file_url).filter(Boolean))];
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

app.get("/api/users", auth, async (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const [{ data: users, error: userError }, { data: messages, error: messageError }] = await Promise.all([
      supabase.from("users").select("id,username,avatar").eq("status", "approved").order("username", { ascending: true }),
      supabase.from("messages").select("id,sender_id,receiver_id,kind,body").or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order("id", { ascending: false }).limit(2000)
    ]);
    if (userError) throw userError;
    if (messageError) throw messageError;
    const latest = new Map();
    for (const message of messages || []) {
      const otherId = Number(message.sender_id) === userId ? Number(message.receiver_id) : Number(message.sender_id);
      if (!latest.has(otherId)) latest.set(otherId, message);
    }
    const result = (users || []).map(user => {
      const id = Number(user.id);
      const isSelf = id === userId;
      const last = latest.get(id);
      return {
        id,
        username: user.username,
        avatar: user.avatar || null,
        isSelf,
        displayName: isSelf ? `${user.username} (You)` : user.username,
        online: isSelf || onlineUsers.has(id),
        lastPreview: last ? (last.kind !== "text" ? `[${last.kind}]` : (last.body || "Message")) : (isSelf ? "Your private conversation" : "Start a conversation")
      };
    });
    result.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.username.localeCompare(b.username));
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
      .select("id,sender_id,receiver_id,kind,body,file_url,file_name,mime_type,created_at")
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${userId})`)
      .order("id", { ascending: false }).limit(1000);
    if (error) throw error;
    const senderIds = [...new Set((data || []).map(message => Number(message.sender_id)))];
    const { data: senders, error: senderError } = senderIds.length
      ? await supabase.from("users").select("id,username").in("id", senderIds)
      : { data: [], error: null };
    if (senderError) throw senderError;
    const names = new Map((senders || []).map(user => [Number(user.id), user.username]));
    const messages = (data || []).reverse().map(message => ({ ...message, sender_name: names.get(Number(message.sender_id)) || "User" }));
    res.json(await signedMessages(messages));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load messages." });
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
    const { data: message, error } = await supabase.from("messages").insert({
      sender_id: req.session.userId,
      receiver_id: receiverId,
      kind: verified.kind,
      body: cleanText(req.body.caption, 500),
      file_url: storagePath,
      file_name: cleanFileName(req.file.originalname),
      mime_type: verified.mime
    }).select("id,sender_id,receiver_id,kind,body,file_url,file_name,mime_type,created_at").single();
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
  addOnlineSocket(userId, socket.id);
  io.emit("presence", { userId, online: true });
  socket.emit("presence:snapshot", { userIds: [...onlineUsers.keys()] });

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
      const { data: message, error } = await supabase.from("messages").insert({
        sender_id: userId,
        receiver_id: receiverId,
        kind: "text",
        body
      }).select("id,sender_id,receiver_id,kind,body,file_url,file_name,mime_type,created_at").single();
      if (error) throw error;
      io.to(`user:${userId}`).to(`user:${receiverId}`).emit("privateMessage", { ...message, sender_name: username });
    } catch (error) {
      console.error("Message failed:", error);
      socket.emit("message:error", { error: "Message could not be sent." });
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
    if (removeOnlineSocket(userId, socket.id)) io.emit("presence", { userId, online: false });
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
  }
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
