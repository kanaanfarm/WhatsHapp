CONNECTCHAT PRO
===============

A cross-platform private chat starter for mobile phones and PCs.

FEATURES
--------
- Registration and login
- Administrator approval for new accounts
- Administrator controls to approve, block, and delete users
- Forgotten username and password recovery using a private recovery code
- Secure password hashing
- Production sessions stored securely in Supabase
- Login, recovery, upload, message, and call abuse limits
- File-content verification and browser security headers
- Private one-to-one chat
- Send text, photos, files, and voice notes to your own account
- Persistent Supabase PostgreSQL message storage
- Private Supabase file storage with expiring signed links
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
For normal use, double-click START_CHAT.bat. It opens the hosted HTTPS app and
does not require Node.js or private server credentials.

The owner/developer can run START_LOCAL_SERVER.bat after creating a private
.env file. Never share that .env file or its Supabase service-role key.

TEST TWO USERS
--------------
1. Register Abokanaan and run admin-migration.sql in Supabase.
2. Log in as Abokanaan and open Manage users.
3. Register user 2 in an Incognito window or another device.
4. Approve user 2 from the administrator panel.
5. Log in as user 2, click the other username, and chat.

USE ON A MOBILE ON THE SAME WI-FI
---------------------------------
1. The owner runs START_LOCAL_SERVER.bat after creating the private .env file.
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
  PUBLIC_ORIGIN=https://your-public-domain.example
  CALLS_ENABLED=false
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
Version 1.2.1 adds a strong pilot security baseline and automatically recovers
from stale browser sessions created by an older release. Before commercial or
large-scale deployment it still requires:
- HTTPS and a real domain
- Email/phone verification
- Push notifications
- Blocking/reporting/moderation
- Antivirus scanning for uploads
- Database backups
- Professional security audit and penetration test
- End-to-end encryption if the product is advertised as E2EE/private from the server
- Cloud deployment
- A production database and shared file/object storage when running multiple servers

SECURITY UPDATE
---------------
Before deploying 1.2.1, follow SECURITY_SETUP.txt and run
security-migration.sql in Supabase. The server intentionally refuses to start
until the secure session table exists.
