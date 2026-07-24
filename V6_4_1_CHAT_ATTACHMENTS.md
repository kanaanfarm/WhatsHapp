# ConnectChat Pro Enterprise v6.4.1

## Photos and documents in user chats

- The attachment paperclip remains visible in the compact message composer.
- Users can select photos, audio, PDF, TXT, CSV, DOCX, XLS/XLSX, PPTX and ZIP
  files.
- Up to ten files can be selected or dropped into a conversation at one time.
- A message typed before selection is attached as the caption of the first
  file.
- Each file has a 12 MB limit and is checked by server-side content detection.
- Upload progress identifies the file currently being sent.
- Photos display in the conversation; documents appear as downloadable file
  messages.
- Attachments remain disabled in ConnectChat AI until document analysis is
  implemented.

Files are stored privately in the configured Supabase bucket and shared only
through the authenticated conversation.
