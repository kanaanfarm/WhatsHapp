# ConnectChat Pro Enterprise v5.3

## AI reliability repair

- Placeholder Ollama addresses are no longer treated as working providers.
- Auto mode changes to the fallback provider after 12 seconds by default.
- AI failures remain visible in the conversation instead of disappearing as a
  short toast.
- Safe diagnostics distinguish timeout, unreachable Ollama, rejected OpenAI
  credentials, and quota/rate-limit problems.
- Failed AI messages are excluded from future AI conversation context.

## User-controlled page

Every user can open **Settings → My page appearance** and control:

- Compact or comfortable layout density
- Small, standard, or large text
- Compact or standard navigation icons
- Narrow or standard conversation sidebar
- Show or hide the workspace overview panel
- Theme and accent colour

Preferences are isolated by ConnectChat account on each device. The professional
default is now compact, with smaller names, avatars, navigation icons, panels,
and headings.

No database migration is required.
