CONNECTCHAT AI - FREE DEMO MODE
================================

The included configuration supports a free Demo Mode. No OpenAI API key or payment is required.

RENDER ENVIRONMENT VARIABLES FOR FREE TESTING
---------------------------------------------
AI_DEMO_MODE=true
AI_ENABLED=false

Do not add OPENAI_API_KEY during free testing.

WHAT DEMO MODE DOES
-------------------
- Shows ConnectChat AI at the top of the users list.
- Lets approved logged-in users open the AI conversation.
- Tests sending, receiving, loading indicators, Arabic and English replies.
- Uses simulated built-in replies. It is not a real ChatGPT model.
- Does not charge anything.

ENABLE REAL AI LATER
--------------------
After you are satisfied with the application, create an API key and change Render variables to:

AI_DEMO_MODE=false
AI_ENABLED=true
OPENAI_API_KEY=your_private_api_key
OPENAI_MODEL=gpt-4.1-mini

Never place a real API key in GitHub or public browser files.
