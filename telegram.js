const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

console.log('🤖 Telegram Bot Started!');

// Store the AI function
let aiFunction = null;

bot.setAIFunction = (func) => {
  aiFunction = func;
};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;
  
  if (!userMessage) return;
  
  try {
    // Show typing indicator
    await bot.sendChatAction(chatId, 'typing');
    
    // Call generateResponse function
    const aiResponse = await aiFunction(userMessage);
    
    // Send response back to Telegram
    await bot.sendMessage(chatId, aiResponse);
  } catch (error) {
    console.error('Telegram bot error:', error);
    await bot.sendMessage(chatId, '❌ Sorry, something went wrong. Please try again.');
  }
});

bot.on('polling_error', (error) => {
  console.error('❌ Polling Error:', error);
});

module.exports = bot;
