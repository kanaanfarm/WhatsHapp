const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

console.log('🤖 Telegram Bot Started!');

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;
  const userName = msg.from.first_name || 'User';

  console.log(`📨 Message from ${userName}: ${userMessage}`);

  await bot.sendChatAction(chatId, 'typing');

  try {
    const aiResponse = await generateAIResponse(userMessage, []);
    await bot.sendMessage(chatId, aiResponse);
    console.log(`✅ Response sent to ${userName}`);
  } catch (error) {
    console.error('❌ Error:', error);
    await bot.sendMessage(chatId, '❌ Sorry, something went wrong. Please try again.');
  }
});

bot.on('polling_error', (error) => {
  console.error('❌ Polling Error:', error);
});

module.exports = bot;
