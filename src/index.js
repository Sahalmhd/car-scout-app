import { config } from './config.js';
import { createBot } from './bot.js';
import { createNotifier } from './notifier.js';
import { createChecker, startScheduler } from './checker.js';
import { log } from './log.js';

if (!config.botToken) {
  log.error('BOT_TOKEN is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!config.allowedChatIds.length) {
  log.warn('ALLOWED_CHAT_IDS is empty: send /start to the bot to get your chat ID, add it to .env, then restart.');
}

const holder = {};
const bot = createBot({
  runCycle: (...a) => holder.checker.runCycle(...a),
  checkFilter: (...a) => holder.checker.checkFilter(...a),
});
holder.checker = createChecker(createNotifier(bot));

startScheduler(holder.checker.runCycle);
log.info(`Checking every ${config.checkIntervalMin} min (+0-${config.jitterMaxMin} min jitter)`);

bot.start({ onStart: (me) => log.info(`Bot @${me.username} is running`) });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    log.info(`${sig} received, stopping`);
    await bot.stop();
    process.exit(0);
  });
}
