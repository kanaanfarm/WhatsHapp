const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

console.log('🤖 Telegram Bot Started!');

// Store AI functions
let aiProviders = null;

bot.setAIProviders = (providers) => {
  aiProviders = providers;
};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;
  
  if (!userMessage) return;
  
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    // Use hybrid: try OpenAI, fallback to Ollama
    let aiResponse;
    if (aiProviders.requestOpenAI) {
      aiResponse = await aiProviders.requestOpenAI(userMessage, []);
    } else if (aiProviders.requestOllama) {
      aiResponse = await aiProviders.requestOllama(userMessage, []);
    }
    
    await bot.sendMessage(chatId, aiResponse);
  } catch (error) {
    console.error('Telegram error:', error);
    await bot.sendMessage(chatId, '❌ Error processing message');
  }
});

bot.on('polling_error', (error) => console.error('Polling Error:', error));

module.exports = bot;
