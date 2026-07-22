# ConnectChat Pro v4.5 – Profile Photos

- Added a full profile page accessible from the account menu or sidebar avatar.
- Users can upload, replace, and remove their own profile photo.
- Supported profile images: JPG, PNG, WEBP, and GIF, up to 12 MB.
- Photos are stored privately in the existing Supabase Storage bucket.
- Signed URLs are used when photos are displayed.
- Profile photos now appear in quick contacts, recent chats, account panel, workspace card, and conversation header.
- Previous profile photo files are deleted when replaced or removed.

The existing `users.avatar` column is used. No new database column is required.
