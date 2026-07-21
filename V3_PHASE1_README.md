# ConnectChat Pro v3.0 — Phase 1 Build

This build upgrades the uploaded ConnectChat Pro AI Edition without replacing its working backend.

## Included
- Professional three-panel responsive interface
- Existing login, registration, approvals, recovery codes and admin controls
- Existing private real-time chat, presence, typing, receipts, uploads and voice notes
- Existing audio/video call foundation and 24-hour status feature
- Theme and accent controls stored locally
- Smart workspace controls prepared for Ollama
- Premium, business and advertising surfaces reserved for later phases
- Existing Helmet, rate limiting, session protection and upload validation retained

## Run locally
1. Copy `.env.example` to `.env` and fill in the required values.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Verification
Run `npm run verify`.

## Important
This is Phase 1, not yet a finished commercial release. Supabase configuration and production secrets are still required. Ollama, subscriptions and advertising management are prepared visually but not activated.
