const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 15 * 1024 * 1024 });
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

console.log("Starting ConnectChat Pro...");
console.log("Opening database...");
const db = new Database(path.join(DATA_DIR, "connectchat.db"), { timeout: 5000 });
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  file_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(sender_id) REFERENCES users(id),
  FOREIGN KEY(receiver_id) REFERENCES users(id)
);
`);

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
app.use("/uploads", express.static(UPLOAD_DIR));
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

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

function safeUser(row) {
  return { id: row.id, username: row.username, avatar: row.avatar || null };
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 10);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav",
      "application/pdf"
    ];
    if (!allowed.includes(file.mimetype)) return cb(new Error("Unsupported file type"));
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
    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
    req.session.userId = Number(info.lastInsertRowid);
    req.session.username = username;
    res.json({ id: Number(info.lastInsertRowid), username, avatar: null });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "Username already exists." });
    console.error(err);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json(safeUser(user));
});

app.post("/api/logout", auth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  const user = db.prepare("SELECT id, username, avatar FROM users WHERE id = ?").get(req.session.userId);
  res.json(safeUser(user));
});

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.get("/api/call-config", auth, (_, res) => {
  const iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(",").map(v => v.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json({ iceServers, turnConfigured: Boolean(process.env.TURN_URL) });
});

app.get("/api/users", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, username, avatar,
      (SELECT body FROM messages
       WHERE (sender_id = users.id AND receiver_id = ?)
          OR (sender_id = ? AND receiver_id = users.id)
       ORDER BY id DESC LIMIT 1) AS last_body,
      (SELECT kind FROM messages
       WHERE (sender_id = users.id AND receiver_id = ?)
          OR (sender_id = ? AND receiver_id = users.id)
       ORDER BY id DESC LIMIT 1) AS last_kind
    FROM users
    WHERE id != ?
    ORDER BY username COLLATE NOCASE
  `).all(req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId);

  res.json(rows.map(u => ({
    id: u.id,
    username: u.username,
    avatar: u.avatar || null,
    online: onlineUsers.has(u.id),
    lastPreview: u.last_kind && u.last_kind !== "text" ? `[${u.last_kind}]` : (u.last_body || "Start a conversation")
  })));
});

app.get("/api/messages/:userId", auth, (req, res) => {
  const otherId = Number(req.params.userId);
  const rows = db.prepare(`
    SELECT m.id, m.sender_id, m.receiver_id, m.kind, m.body, m.file_url,
           m.file_name, m.mime_type, m.created_at, u.username AS sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE (m.sender_id = ? AND m.receiver_id = ?)
       OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.id ASC
    LIMIT 1000
  `).all(req.session.userId, otherId, otherId, req.session.userId);
  res.json(rows);
});

app.post("/api/upload", auth, upload.single("file"), (req, res) => {
  const receiverId = Number(req.body.receiverId);
  const kind = String(req.body.kind || "file");
  if (!req.file || !receiverId) return res.status(400).json({ error: "Missing file or receiver." });

  const receiver = db.prepare("SELECT id FROM users WHERE id = ?").get(receiverId);
  if (!receiver) return res.status(404).json({ error: "Receiver not found." });

  const url = `/uploads/${req.file.filename}`;
  const info = db.prepare(`
    INSERT INTO messages (sender_id, receiver_id, kind, body, file_url, file_name, mime_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.session.userId,
    receiverId,
    kind,
    String(req.body.caption || "").slice(0, 500),
    url,
    req.file.originalname,
    req.file.mimetype
  );

  const message = db.prepare(`
    SELECT m.id, m.sender_id, m.receiver_id, m.kind, m.body, m.file_url,
           m.file_name, m.mime_type, m.created_at, u.username AS sender_name
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(info.lastInsertRowid);

  io.to(`user:${req.session.userId}`).to(`user:${receiverId}`).emit("privateMessage", message);
  res.json(message);
});

io.on("connection", socket => {
  const sess = socket.request.session;
  if (!sess || !sess.userId) return socket.disconnect(true);

  const userId = Number(sess.userId);
  const username = sess.username;
  socket.join(`user:${userId}`);
  addOnlineSocket(userId, socket.id);
  io.emit("presence", { userId, online: true });

  socket.on("privateMessage", payload => {
    const receiverId = Number(payload.receiverId);
    const body = String(payload.body || "").trim().slice(0, 2000);
    if (!receiverId || !body) return;

    const receiver = db.prepare("SELECT id FROM users WHERE id = ?").get(receiverId);
    if (!receiver) return;

    const info = db.prepare(`
      INSERT INTO messages (sender_id, receiver_id, kind, body)
      VALUES (?, ?, 'text', ?)
    `).run(userId, receiverId, body);

    const message = db.prepare(`
      SELECT m.id, m.sender_id, m.receiver_id, m.kind, m.body, m.file_url,
             m.file_name, m.mime_type, m.created_at, u.username AS sender_name
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
    `).get(info.lastInsertRowid);

    io.to(`user:${userId}`).to(`user:${receiverId}`).emit("privateMessage", message);
  });

  socket.on("typing", payload => {
    const receiverId = Number(payload.receiverId);
    if (!receiverId) return;
    io.to(`user:${receiverId}`).emit("typing", {
      userId, username, isTyping: Boolean(payload.isTyping)
    });
  });

  // WebRTC signaling. Audio/video travels directly between the callers (or via TURN).
  socket.on("call:start", payload => {
    const receiverId = Number(payload.receiverId);
    if (!receiverId || !onlineUsers.has(receiverId)) {
      return socket.emit("call:unavailable", { receiverId });
    }
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
    if (receiverId && payload.candidate) {
      io.to(`user:${receiverId}`).emit("call:ice", { userId, candidate: payload.candidate });
    }
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Request failed." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ConnectChat Pro is running at http://localhost:${PORT}`);
});
