{
  "name": "connectchat-pro-desktop",
  "version": "1.4.0",
  "description": "ConnectChat Pro desktop client",
  "main": "main.js",
  "author": "ConnectChat Pro",
  "license": "UNLICENSED",
  "private": true,
  "scripts": {
    "start": "electron .",
    "build:windows": "electron-builder --win nsis"
  },
  "devDependencies": {
    "electron": "^37.2.0",
    "electron-builder": "^26.0.12"
  },
  "build": {
    "appId": "com.connectchat.pro",
    "productName": "ConnectChat Pro",
    "files": ["main.js", "preload.js", "config.json", "offline.html"],
    "win": { "target": "nsis" },
    "nsis": {
      "oneClick": true,
      "perMachine": false,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
