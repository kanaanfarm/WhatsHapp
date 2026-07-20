const { app, BrowserWindow, shell, session } = require("electron");
const path = require("path");
const config = require("./config.json");

const appUrl = new URL(process.env.CONNECTCHAT_URL || config.appUrl);
if (appUrl.protocol !== "https:") throw new Error("ConnectChat desktop requires an HTTPS application URL.");
const appOrigin = appUrl.origin;

function isTrustedAppUrl(value) {
  try { return new URL(value).origin === appOrigin; } catch { return false; }
}

function isSafeExternalUrl(value) {
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "ConnectChat Pro",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });
  win.webContents.on("will-redirect", (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", event => event.preventDefault());
  win.loadURL(appUrl.href).catch(() => win.loadFile("offline.html"));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === "media" && isTrustedAppUrl(requestingOrigin || webContents?.getURL() || "");
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(permission === "media" && isTrustedAppUrl(requestingUrl));
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
