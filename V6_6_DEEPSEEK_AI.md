# ConnectChat Pro Enterprise v6.6

- Added DeepSeek cloud API support.
- Added DeepSeek to the in-chat AI provider selector.
- Supports `AI_PROVIDER=deepseek` or three-provider `AI_PROVIDER=hybrid`.
- Uses current DeepSeek V4 model names.
- Defaults to `deepseek-v4-flash`; `deepseek-v4-pro` is configurable.
- Auto mode can fall back among DeepSeek, OpenAI and Ollama.
- DeepSeek API keys remain server-side and are never included in browser code.
