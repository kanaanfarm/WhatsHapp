const TelegramBot = require("node-telegram-bot-api");

const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");

const bot = new TelegramBot(token, { polling: true });

console.log("Telegram bot started.");

let aiProviders = null;
const selectedProviderByChat = new Map();
const providerLabels = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  ollama: "Ollama"
};

bot.setAIProviders = providers => {
  aiProviders = providers || null;
};

function providerOrder(chatId) {
  const selected = selectedProviderByChat.get(String(chatId));
  const preferred = aiProviders?.preferredProvider;
  return [...new Set([selected, preferred, "openai", "deepseek", "ollama"].filter(Boolean))];
}

function providerFunction(name) {
  if (name === "openai") return aiProviders?.requestOpenAI;
  if (name === "deepseek") return aiProviders?.requestDeepSeek;
  if (name === "ollama") return aiProviders?.requestOllama;
  return null;
}

async function showProviderMenu(chatId) {
  const selected = selectedProviderByChat.get(String(chatId)) || aiProviders?.preferredProvider || "openai";
  await bot.sendMessage(chatId, `AI provider: ${providerLabels[selected] || selected}\nChoose the provider you want to use:`, {
    reply_markup: {
      inline_keyboard: [[
        { text: selected === "openai" ? "\u2705 OpenAI" : "OpenAI", callback_data: "ai_provider:openai" },
        { text: selected === "deepseek" ? "\u2705 DeepSeek" : "DeepSeek", callback_data: "ai_provider:deepseek" },
        { text: selected === "ollama" ? "\u2705 Ollama" : "Ollama", callback_data: "ai_provider:ollama" }
      ]]
    }
  });
}

bot.on("callback_query", async query => {
  const data = String(query.data || "");
  if (!data.startsWith("ai_provider:")) return;

  const providerName = data.slice("ai_provider:".length);
  const chatId = query.message?.chat?.id;
  if (!chatId || !providerLabels[providerName]) return;

  if (typeof providerFunction(providerName) !== "function") {
    await bot.answerCallbackQuery(query.id, { text: `${providerLabels[providerName]} is not configured.` });
    await bot.sendMessage(chatId, `${providerLabels[providerName]} is not available on the ConnectChat server yet.`);
    return;
  }

  selectedProviderByChat.set(String(chatId), providerName);
  await bot.answerCallbackQuery(query.id, { text: `${providerLabels[providerName]} selected.` });
  await bot.sendMessage(chatId, `\u2705 ${providerLabels[providerName]} is now your selected AI provider.`);
});

bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const userMessage = String(msg.text || "").trim();
  if (!userMessage) return;

  if (/^\/provider(?:@\w+)?$/i.test(userMessage)) {
    if (!aiProviders) {
      await bot.sendMessage(chatId, "ConnectChat AI is still starting. Please try again in a moment.");
      return;
    }
    await showProviderMenu(chatId);
    return;
  }

  if (!aiProviders) {
    await bot.sendMessage(chatId, "ConnectChat AI is still starting. Please try again in a moment.");
    return;
  }

  try {
    await bot.sendChatAction(chatId, "typing");

    let aiResponse = "";
    let lastError = null;
    let usedProvider = null;
    const selectedProvider = selectedProviderByChat.get(String(chatId));

    for (const providerName of providerOrder(chatId)) {
      const requestAI = providerFunction(providerName);
      if (typeof requestAI !== "function") continue;

      try {
        aiResponse = await requestAI(userMessage, []);
        if (aiResponse) {
          usedProvider = providerName;
          break;
        }
      } catch (error) {
        lastError = error;
        console.error(`Telegram ${providerName} AI attempt failed:`, error.message || error);
      }
    }

    if (!aiResponse) throw lastError || new Error("No configured AI provider could answer.");
    await bot.sendMessage(chatId, String(aiResponse));
    if (selectedProvider && usedProvider && selectedProvider !== usedProvider) {
      await bot.sendMessage(chatId, `\u26a0\ufe0f ${providerLabels[selectedProvider]} was unavailable, so ${providerLabels[usedProvider]} answered this message.`);
    }
  } catch (error) {
    console.error("Telegram error:", error.message || error);
    await bot.sendMessage(chatId, "Sorry, ConnectChat AI could not answer right now. Please try again shortly.");
  }
});

bot.on("polling_error", error => console.error("Telegram polling error:", error.message || error));

module.exports = bot;
