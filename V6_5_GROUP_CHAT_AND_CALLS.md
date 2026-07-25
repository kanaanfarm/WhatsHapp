# ConnectChat Pro Enterprise v6.5

## Added

- WhatsApp-style group conversation screen with left/right message bubbles.
- Rounded message box with emoji, attachment position, and green send arrow.
- Group creation with approved-member selection.
- Live group messages through the existing synchronized group database.
- Group voice and video conference controls for up to six participants.
- Incoming group-call invitation and participant video grid.
- Group chat remains visible and usable while the conference panel is open.

## Required

- Run `enterprise-v5-migration.sql` once if the Groups database tables were not installed previously.
- Set `CALLS_ENABLED=true`.
- Configure TURN on Render for reliable calls between different countries or mobile networks.

## Conference architecture

Version 6.5 uses a small-group peer-to-peer mesh. It is appropriate for testing
and groups of up to six people. Larger commercial conferences should use an SFU
service such as LiveKit.
