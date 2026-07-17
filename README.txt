CONNECTCHAT PRO
===============

A cross-platform private chat starter for mobile phones and PCs.

FEATURES
--------
- Registration and login
- Secure password hashing
- Private one-to-one chat
- Permanent SQLite message storage
- Online/offline status
- Typing indicator
- Send and paste photos
- Take a photo from a mobile camera
- Record and send voice notes
- One-to-one audio and video calling (WebRTC)
- Send PDF files
- Responsive mobile and desktop design
- Installable PWA
- Windows one-click launcher
- Build-ready Windows EXE and Android APK client projects

RUN ON WINDOWS
--------------
1. Extract the ZIP file completely.
2. Install Node.js LTS.
3. Double-click START_CHAT.bat.
4. Keep the black server window open.
5. Open http://localhost:3000

TEST TWO USERS
--------------
1. Register user 1 in Chrome.
2. Open an Incognito window or another browser.
3. Register user 2.
4. Click the other username and chat.

USE ON A MOBILE ON THE SAME WI-FI
---------------------------------
1. Run the application on the PC.
2. In Windows Command Prompt, run: ipconfig
3. Find the PC IPv4 address, for example 192.168.1.20
4. On the phone, open: http://192.168.1.20:3000
5. Allow Windows Firewall access for private networks.

INTERNATIONAL USE (UAE, LEBANON, AND OTHER COUNTRIES)
-----------------------------------------------------
Do not expose the Windows PC or port 3000 directly to the Internet.
Deploy the app on a public Linux server behind an HTTPS domain. HTTPS is required
for camera and microphone access outside localhost.

Reliable calls across countries and mobile operators require a TURN service.
Set these environment variables on the public server:

  SESSION_SECRET=a-long-random-secret
  NODE_ENV=production
  TURN_URL=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
  TURN_USERNAME=your-turn-username
  TURN_CREDENTIAL=your-turn-password

Without TURN, calls may work on some networks but fail on restrictive mobile,
office, hotel, or carrier-grade NAT networks.

INSTALL ON MOBILE OR PC
-----------------------
When supported by the browser, use the "Install app" button.
On iPhone Safari, use Share > Add to Home Screen.

IMPORTANT LIMITATIONS
---------------------
This is a strong working starter, but public commercial deployment still requires:
- HTTPS and a real domain
- Email/phone verification
- Password recovery
- Push notifications
- Blocking/reporting/moderation
- Antivirus scanning for uploads
- Rate limiting
- Database backups
- Security audit
- Cloud deployment
- A production database and shared file/object storage when running multiple servers
