# ConnectChat Pro Enterprise v5.1

This repair release makes the existing AI assistant usable and connects the
Smart Workspace controls to real AI processing.

## Fixed

- Summarize, Action items, and Translate now analyze the selected conversation.
- ConnectChat AI remains visible when setup is incomplete and reports what is
  missing instead of silently disappearing.
- Provider authentication, rate-limit, timeout, empty-response, and Ollama
  connection errors now have useful messages.

## Added

- OpenAI and local Ollama provider selection.
- Authenticated AI status endpoint.
- Provider and model status in the AI conversation header.
- Larger AI response allowance for useful summaries.

## Upgrade

No database migration is required. Copy the updated application files, configure
the variables in `AI_SETUP.txt`, and restart or redeploy the server.
