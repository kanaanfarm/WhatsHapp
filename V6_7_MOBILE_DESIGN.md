# ConnectChat Pro v6.7.3 — mobile redesign

Version 6.7 replaces the compressed desktop layout on phones with a
WhatsApp-inspired mobile experience while retaining ConnectChat branding.

Version 6.7.1 centers and reduces the send icon, isolates the call screen from
the bottom navigation, shows a clear remote-camera waiting state, and adds a
front/rear mobile camera switch.

Version 6.7.2 adds a WhatsApp-inspired mobile You/Settings page and reduces
duplicate network refreshes, hidden-panel rendering, repeated image decoding
and expensive mobile paint effects.

Version 6.7.3 renders Settings before displaying the page and pauses background
conversation-list updates while any other workspace is open.

The updated v6.7.3 package also restores the mobile emoji picker, makes Create
Group prominent on mobile, and adds optional email/phone password sign-in under
Settings. Username remains the default identifier. The included
`v6.7.3-email-phone-signin-migration.sql` must be run once in Supabase.

Group owners and group administrators can now send invitations, add approved
users and remove members. The owner can promote or demote group administrators.
Run `v6.7.3-group-invitations-migration.sql` once in Supabase.

## Mobile improvements

- Full-width conversation list and full-screen open conversation
- Bottom navigation for Chats, Calls, Groups, AI and Settings
- Compact chat header with Back, audio call, video call and menu
- Visible paperclip and camera buttons beside the message field
- Green microphone button while the field is empty
- Green send-arrow button while typing
- Compact message bubbles with readable delivery information
- Safe-area spacing for modern iPhone screens

The camera button uses the existing secure mobile file input with
`capture="environment"`. The browser will request camera/photo permission the
first time it is used.

## After deployment

Render must deploy this v6.7 package. On a phone, close the old installed web
app or browser tab and reopen it. If v6.6 remains visible, clear the site cache
or remove and reinstall the PWA so the v6.7 service worker is loaded.
