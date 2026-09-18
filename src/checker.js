import { config } from './config.js';
import { repo, ALERT } from './db.js';
import { fetchListings, parseItem, matchesScope, BlockedError } from './olx.js';
import { esc } from './notifier.js';
import { log, sleep, randomBetween } from './log.js';

const FAIL_WARN_AT = 3;
const EMPTY_WARN_AT = 3;
const MAX_BACKOFF_MIN = 180;

export const state = {
  running: false,
  lastRunAt: null,
  lastRunSummary: null,
  nextRunAt: null,
  blockedStreak: 0,
};

export function backoffMinutes() {
  if (state.blockedStreak === 0) return 0;
  return Math.min(config.checkIntervalMin * 2 ** state.blockedStreak, MAX_BACKOFF_MIN);
}

export function createChecker(notifier) {
  async function sendPending(filter) {
    const pending = repo.pending(filter.id);
    const toSend = pending.slice(0, config.maxAlertsPerRun);
    let sent = 0;
    for (const l of toSend) {
      try {
        await notifier.sendListing(filter.chat_id, l, filter);
        repo.markNotified(l.ad_id, filter.id);
        sent++;
      } catch (err) {
        log.error(`Alert failed for ad ${l.ad_id} (filter #${filter.id}), will retry next run: ${err.message}`);
        break;
      }
    }
    const overflow = pending.slice(config.maxAlertsPerRun);
    if (overflow.length && sent === toSend.length) {
      for (const l of overflow) repo.markNotified(l.ad_id, filter.id, ALERT.SILENT);
      await notifier.sendText(
        filter.chat_id,
        `…and <b>${overflow.length} more</b> new cars for #${filter.id} ${esc(filter.name)}. See /latest ${filter.id} 20`
      );
    }
  }

  async function checkFilter(filter) {
    const raw = await fetchListings(filter.api_query, filter.olx_url);
    const listings = raw.map(parseItem).filter(Boolean).filter((l) => matchesScope(l, filter));
    const known = repo.knownIds(filter.id);
    const fresh = listings.filter((l) => !known.has(l.adId));

    if (!filter.initialized) {
      repo.insertListings(filter.id, fresh, ALERT.SILENT);
      repo.markInitialized(filter.id);
      repo.recordSuccess(filter.id, listings.length);
      await notifier.sendText(
        filter.chat_id,
        `✅ <b>Tracking started · #${filter.id} ${esc(filter.name)}</b>\n` +
          `${listings.length} cars currently match. You'll get an alert for every new one.\n` +
          `See the latest with /latest ${filter.id}`
      );
      return 0;
    }

    repo.insertListings(filter.id, fresh, ALERT.PENDING);
    repo.recordSuccess(filter.id, listings.length);

    await sendPending(filter);

    if (listings.length === 0 && filter.empty_count + 1 === EMPTY_WARN_AT) {
      await notifier.sendText(
        filter.chat_id,
        `⚠️ #${filter.id} ${esc(filter.name)} returned 0 cars ${EMPTY_WARN_AT} checks in a row.\n` +
          `The filter may be too narrow, or OLX changed something. Check the link on OLX.`
      );
    }
    return fresh.length;
  }

  async function runCycle() {
    if (state.running) return { skipped: true };
    state.running = true;
    const summary = { checked: 0, newCars: 0, failed: 0, blocked: false };
    try {
      const filters = repo.activeFilters();
      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        try {
          summary.newCars += await checkFilter(filter);
          summary.checked++;
        } catch (err) {
          summary.failed++;
          repo.recordFailure(filter.id, err.message);
          log.warn(`Filter #${filter.id} failed: ${err.constructor.name} ${err.message}`);
          if (err instanceof BlockedError) {
            summary.blocked = true;
            break;
          }
          if (filter.fail_count + 1 === FAIL_WARN_AT) {
            await notifier.sendText(
              filter.chat_id,
              `⚠️ #${filter.id} ${esc(filter.name)} failed ${FAIL_WARN_AT} times in a row.\nLast error: ${esc(err.message)}`
            );
          }
        }
        if (i < filters.length - 1) await sleep(randomBetween(config.delayMinSec, config.delayMaxSec) * 1000);
      }

      if (summary.blocked) {
        state.blockedStreak++;
        if (state.blockedStreak === 1) {
          const chats = new Set(filters.map((f) => f.chat_id));
          for (const chat of chats) {
            await notifier.sendText(
              chat,
              `🚫 OLX is blocking requests right now. Pausing checks for ${backoffMinutes()} min and backing off further if it continues.`
            );
          }
        }
      } else if (summary.checked > 0 || filters.length === 0) {
        if (state.blockedStreak > 0) {
          log.info('No longer blocked, back to normal interval');
          for (const chat of new Set(filters.map((f) => f.chat_id))) {
            await notifier.sendText(chat, '✅ OLX checks are working again.');
          }
        }
        state.blockedStreak = 0;
      }
    } finally {
      state.running = false;
      state.lastRunAt = new Date();
      state.lastRunSummary = summary;
    }
    log.info(`Cycle done: ${JSON.stringify(summary)}`);
    return summary;
  }

  return { runCycle, checkFilter, sendPending };
}

export function startScheduler(runCycle) {
  const schedule = (delayMs) => {
    state.nextRunAt = new Date(Date.now() + delayMs);
    setTimeout(async () => {
      try {
        await runCycle();
      } catch (err) {
        log.error('Cycle crashed:', err);
      }
      const baseMin = state.blockedStreak ? backoffMinutes() : config.checkIntervalMin;
      schedule((baseMin + randomBetween(0, config.jitterMaxMin)) * 60_000);
    }, delayMs);
  };
  schedule(30_000);
}
