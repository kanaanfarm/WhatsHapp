const TelegramBot = require("node-telegram-bot-api");

const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");

const bot = new TelegramBot(token, { polling: true });

console.log("Telegram bot started.");

let aiProviders = null;

bot.setAIProviders = providers => {
  aiProviders = providers || null;
};

function providerOrder() {
  const preferred = aiProviders?.preferredProvider;
  return [...new Set([preferred, "openai", "deepseek", "ollama"].filter(Boolean))];
}

function providerFunction(name) {
  if (name === "openai") return aiProviders?.requestOpenAI;
  if (name === "deepseek") return aiProviders?.requestDeepSeek;
  if (name === "ollama") return aiProviders?.requestOllama;
  return null;
}

bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const userMessage = String(msg.text || "").trim();
  if (!userMessage) return;

  if (!aiProviders) {
    await bot.sendMessage(chatId, "ConnectChat AI is still starting. Please try again in a moment.");
    return;
  }

  try {
    await bot.sendChatAction(chatId, "typing");

    let aiResponse = "";
    let lastError = null;

    for (const providerName of providerOrder()) {
      const requestAI = providerFunction(providerName);
      if (typeof requestAI !== "function") continue;

      try {
        aiResponse = await requestAI(userMessage, []);
        if (aiResponse) break;
      } catch (error) {
        lastError = error;
        console.error(`Telegram ${providerName} AI attempt failed:`, error.message || error);
      }
    }

    if (!aiResponse) throw lastError || new Error("No configured AI provider could answer.");
    await bot.sendMessage(chatId, String(aiResponse));
  } catch (error) {
    console.error("Telegram error:", error.message || error);
    await bot.sendMessage(chatId, "Sorry, ConnectChat AI could not answer right now. Please try again shortly.");
  }
});

bot.on("polling_error", error => console.error("Telegram polling error:", error.message || error));

module.exports = bot;
