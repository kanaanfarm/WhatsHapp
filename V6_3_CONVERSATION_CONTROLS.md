# ConnectChat Pro Enterprise v6.3

## Conversation interface

- The message composer is compact and no longer reserves space for Smart
  Workspace.
- Each contact and the active chat header have an AI tools icon.
- AI summary, action-item and translation tools open in a small popup.
- Each ordinary conversation can be archived and restored.
- **Delete all chat** requires confirmation and removes the messages and
  attachments for both participants.

## Workspace overview

Overview, Files and Media tabs are functional. Files and media reflect the
currently selected conversation.

## Administrator calculation sheets

Approved users who have preview permission can open administrator-uploaded
calculation sheets and read saved results. Only administrators can download
the original administrator-uploaded file. The server enforces this restriction
even if someone calls the download endpoint directly.

## Required database step

Run `v6.3-conversation-controls-migration.sql` once in Supabase SQL Editor to
enable persistent per-user chat archiving.
