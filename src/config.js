try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {}

const int = (name, def) => {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
};

export const config = {
  botToken: process.env.BOT_TOKEN ?? '',
  allowedChatIds: (process.env.ALLOWED_CHAT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  checkIntervalMin: int('CHECK_INTERVAL_MIN', 20),
  jitterMaxMin: int('JITTER_MAX_MIN', 3),
  delayMinSec: int('DELAY_MIN_SEC', 10),
  delayMaxSec: int('DELAY_MAX_SEC', 30),
  maxAlertsPerRun: int('MAX_ALERTS_PER_RUN', 15),
  proxyUrl: process.env.PROXY_URL?.trim() || '',
  dbPath: process.env.DB_PATH ?? new URL('../data/cars.db', import.meta.url).pathname,
};
