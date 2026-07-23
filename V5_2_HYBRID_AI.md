# ConnectChat Pro Enterprise v5.2 Hybrid AI

## New

- Select **Auto**, **Ollama**, or **OpenAI** inside ConnectChat AI.
- Auto mode tries the administrator's default provider first.
- If the default provider fails, Auto tries the other configured provider.
- Every answer shows which provider and model generated it.
- Smart conversation actions use the user's selected provider.
- Unavailable providers are disabled in the selector.

## Recommended Render variables

```env
AI_ENABLED=true
AI_PROVIDER=hybrid
AI_DEFAULT_PROVIDER=ollama
OPENAI_API_KEY=your-private-key
OPENAI_MODEL=gpt-4.1-mini
OLLAMA_URL=https://your-secured-ollama-server.example.com
OLLAMA_MODEL=qwen2.5:7b
AI_REQUEST_TIMEOUT_MS=120000
```

The Ollama URL must be reachable from Render. `127.0.0.1` on Render is the
Render container and is not the user's Windows computer.

No database migration is required.
