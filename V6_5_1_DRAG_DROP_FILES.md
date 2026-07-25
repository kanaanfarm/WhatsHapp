# ConnectChat Pro Enterprise v6.5.1

- Fixed Windows/Edge drag-and-drop detection in private chats.
- Files can be dropped anywhere over the active private chat.
- Added file picker and drag-and-drop uploads to group chats.
- Added group photo, audio and document rendering inside WhatsApp-style bubbles.
- Added a visible drop-zone overlay.

Run `v6.5.1-group-attachments-migration.sql` once in Supabase SQL Editor before
using group attachments. Private-chat drag and drop does not require this new
migration.
