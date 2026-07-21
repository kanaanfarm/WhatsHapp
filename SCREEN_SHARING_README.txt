CONNECTCHAT PRO - SCREEN SHARING UPDATE

What was added
- Share Screen button during a video call
- Share the entire screen, an application window, or a browser tab
- Stop sharing and return to the camera without ending the call
- Automatic return to camera when the browser sharing dialog is stopped
- Screen-sharing status shown to the other participant

How to test locally
1. Start the server with START_CHAT.bat or npm start.
2. Log in with two approved accounts in two separate browsers or devices.
3. Start a video call.
4. Click Share screen.
5. Choose a screen, window, or browser tab.
6. Click Stop sharing to return to the camera.

Important
- Screen sharing is available during video calls.
- On a public server, use HTTPS.
- Chrome and Microsoft Edge provide the best desktop support.
- For reliable calls between different internet networks, configure TURN_URL, TURN_USERNAME, and TURN_CREDENTIAL in .env.
- The browser always asks the user for permission before screen sharing.
