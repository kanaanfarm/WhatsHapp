const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 15 * 1024 * 1024 });
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || "connectchat-files";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const allowedMimeTypes = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav",
  "application/pdf", "text/plain", "application/zip", "application/x-zip-compressed",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
];

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "connectchat-pro-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 14,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(ROOT, "public")));
io.engine.use(sessionMiddleware);

const onlineUsers = new Map();

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
  return crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
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
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(message.file_url, 60 * 60);
  if (error) console.error("Could not sign file URL:", error.message);
  return { ...message, file_url: data?.signedUrl || null };
}

async function signedMessages(messages) {
  return Promise.all((messages || []).map(signedMessage));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) return cb(new Error("Unsupported file type"));
    cb(null, true);
  }
});

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim().slice(0, 30);
  const password = String(req.body.password || "");
  if (!/^[A-Za-z0-9_ ]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Use 3–30 letters, numbers, spaces, or underscores." });
  }
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
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
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const { data: user, error } = await supabase.from("users").select("id,username,avatar,password_hash,status,is_admin").eq("username", username).maybeSingle();
    if (error) throw error;
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    if (user.status !== "approved") {
      return res.status(403).json({
        error: user.status === "blocked" ? "This account has been blocked by the administrator." : "Your account is waiting for administrator approval.",
        code: String(user.status || "pending").toUpperCase()
      });
    }
    req.session.userId = Number(user.id);
    req.session.username = user.username;
    res.json(safeUser(user));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

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
    const { data: user, error } = await supabase.from("users").select("username").eq("recovery_hash", recoveryHash(code)).maybeSingle();
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
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    const { data: user, error: findError } = await supabase.from("users").select("id,username").eq("recovery_hash", recoveryHash(code)).maybeSingle();
    if (findError) throw findError;
    if (!user) return res.status(404).json({ error: "Recovery code not found." });
    const passwordHash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from("users").update({ password_hash: passwordHash }).eq("id", user.id);
    if (error) throw error;
    res.json({ ok: true, username: user.username });
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
  res.status(error ? 503 : 200).json({ ok: !error, database: error ? "unavailable" : "connected" });
});

app.get("/api/call-config", auth, (_, res) => {
  const iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(",").map(value => value.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json({ iceServers, turnConfigured: Boolean(process.env.TURN_URL) });
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
    const extension = path.extname(req.file.originalname || "").slice(0, 12).toLowerCase();
    storagePath = `${req.session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false
    });
    if (uploadError) throw uploadError;
    const kind = req.file.mimetype.startsWith("image/") ? "image" : (req.file.mimetype.startsWith("audio/") ? "voice" : "file");
    const { data: message, error } = await supabase.from("messages").insert({
      sender_id: req.session.userId,
      receiver_id: receiverId,
      kind,
      body: String(req.body.caption || "").slice(0, 500),
      file_url: storagePath,
      file_name: String(req.file.originalname || "file").slice(0, 255),
      mime_type: req.file.mimetype
    }).select("id,sender_id,receiver_id,kind,body,file_url,file_name,mime_type,created_at").single();
    if (error) throw error;
    const outgoing = await signedMessage({ ...message, sender_name: req.session.username });
    io.to(`user:${req.session.userId}`).to(`user:${receiverId}`).emit("privateMessage", outgoing);
    res.json(outgoing);
  } catch (error) {
    if (storagePath) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    console.error(error);
    res.status(400).json({ error: error.message || "Upload failed." });
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
      const receiverId = Number(payload.receiverId);
      const body = String(payload.body || "").trim().slice(0, 2000);
      if (!receiverId || !body) return;
      const receiver = await getUserById(receiverId, "id,status");
      if (!receiver || receiver.status !== "approved") return;
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
    const receiverId = Number(payload.receiverId);
    if (receiverId && receiverId !== userId) io.to(`user:${receiverId}`).emit("typing", { userId, username, isTyping: Boolean(payload.isTyping) });
  });

  socket.on("call:start", payload => {
    const receiverId = Number(payload.receiverId);
    if (!receiverId || receiverId === userId || !onlineUsers.has(receiverId)) return socket.emit("call:unavailable", { receiverId });
    io.to(`user:${receiverId}`).emit("call:incoming", {
      callerId: userId,
      callerName: username,
      mode: payload.mode === "audio" ? "audio" : "video",
      offer: payload.offer
    });
  });

  socket.on("call:answer", payload => {
    const receiverId = Number(payload.receiverId);
    if (receiverId) io.to(`user:${receiverId}`).emit("call:answered", { userId, answer: payload.answer });
  });
  socket.on("call:ice", payload => {
    const receiverId = Number(payload.receiverId);
    if (receiverId && payload.candidate) io.to(`user:${receiverId}`).emit("call:ice", { userId, candidate: payload.candidate });
  });
  socket.on("call:reject", payload => {
    const receiverId = Number(payload.receiverId);
    if (receiverId) io.to(`user:${receiverId}`).emit("call:rejected", { userId });
  });
  socket.on("call:end", payload => {
    const receiverId = Number(payload.receiverId);
    if (receiverId) io.to(`user:${receiverId}`).emit("call:ended", { userId });
  });
  socket.on("disconnect", () => {
    if (removeOnlineSocket(userId, socket.id)) io.emit("presence", { userId, online: false });
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(400).json({ error: error.message || "Request failed." });
});

async function start() {
  console.log("Starting ConnectChat Pro with Supabase storage...");
  const { error: databaseError } = await supabase.from("users").select("id,status,is_admin", { head: true, count: "exact" });
  if (databaseError) throw new Error(`Supabase database is not ready: ${databaseError.message}`);
  const { data: bucket, error: bucketError } = await supabase.storage.getBucket(STORAGE_BUCKET);
  if (bucketError && !String(bucketError.message).toLowerCase().includes("not found")) throw bucketError;
  if (!bucket) {
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: 12 * 1024 * 1024,
      allowedMimeTypes
    });
    if (error) throw error;
  }
  server.listen(PORT, "0.0.0.0", () => console.log(`ConnectChat Pro is running at http://localhost:${PORT}`));
}

start().catch(error => {
  console.error(error);
  process.exit(1);
});
