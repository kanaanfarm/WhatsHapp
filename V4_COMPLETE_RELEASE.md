# ConnectChat Pro v4.2 Workspace

This release is built on the working Node.js + Supabase project and replaces the main application workspace with the agreed collaboration layout.

## Working features retained
- Login, registration, administrator approval, account recovery
- Real-time private messaging with Socket.IO
- Message history, delivery/read receipts, typing and presence
- Image, voice and file uploads
- Status posts and administrator user management
- Audio and video calls

## New in v4.2
- Full left workspace navigation rail
- Modern conversation panel, filters, quick contacts and unread badge
- Proposal-style chat workspace and smart workspace panel
- Conversation search for currently loaded messages
- Real WebRTC screen sharing during video calls
- Stop sharing and return to the camera without ending the call
- Updated service-worker cache

## Screen sharing
1. Select an online user.
2. Start a video call and wait for acceptance.
3. Click **Share screen** in the call window.
4. Select an entire screen, window, or browser tab.
5. Click **Stop sharing** to return to the camera.

Screen sharing requires HTTPS in production. `localhost` is also supported by modern browsers.

## Important scope
Groups and channels are visible as workspace modules, but a dedicated group/channel database schema and server API are not included in this release. Existing real private-chat functionality is preserved.
