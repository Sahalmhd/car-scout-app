import { Bot, InlineKeyboard } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from './config.js';
import { repo } from './db.js';
import { parseFilterUrl, resolveApiQuery, currentProxy } from './olx.js';
import { esc, formatPrice, timeAgo } from './notifier.js';
import { state, backoffMinutes } from './checker.js';
import { log } from './log.js';

const HELP = `<b>OLX Car Alerts</b>

1. Open OLX, apply your filters (city, model, year, price…)
2. Copy the page link and send it here
3. You get a message for every new car that matches

<b>Commands</b>
/add &lt;olx link&gt; [name] – track a filter
/list – your filters
/latest &lt;id&gt; [n] – last cars found
/scope &lt;id&gt; city|nearby – only the chosen city, or nearby districts too
/pause &lt;id&gt; · /resume &lt;id&gt;
/remove &lt;id&gt; – stop tracking
/reset &lt;id&gt; [n] – send the newest n cars again (test alerts)
/check – check OLX right now
/status – health of the checker`;

export function createBot(checker) {
  const bot = new Bot(config.botToken);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  bot.use(async (ctx, next) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (config.allowedChatIds.includes(chatId)) return next();
    if (ctx.message?.text?.startsWith('/start')) {
      await ctx.reply(`This bot is private.\nYour chat ID is <code>${chatId}</code>. Add it to ALLOWED_CHAT_IDS in .env and restart the bot.`, {
        parse_mode: 'HTML',
      });
    }
    log.warn(`Ignored update from chat ${chatId}`);
  });

  const reply = (ctx, html, extra = {}) =>
    ctx.reply(html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

  const idArg = (ctx) => parseInt(String(ctx.match ?? '').trim().split(/\s+/)[0], 10);

  async function addFilter(ctx, url, name) {
    const parsed = parseFilterUrl(url);
    if (!parsed) {
      return reply(ctx, 'That is not an OLX search link. Open a search on olx.in (e.g. cars in Kozhikode with filters) and copy the link from the address bar.');
    }
    const existing = repo.findFilterByUrl(parsed.url, ctx.chat.id);
    if (existing) return reply(ctx, `Already tracking this as #${existing.id} ${esc(existing.name)}.`);

    await reply(ctx, '⏳ Reading the filter from OLX…');
    let apiQuery;
    try {
      apiQuery = await resolveApiQuery(parsed.url);
    } catch (err) {
      log.warn(`Resolve failed for ${parsed.url}: ${err.message}`);
      return reply(ctx, `Couldn't read that OLX page (${esc(err.message)}). Check the link opens a search results page and try again.`);
    }

    const id = repo.addFilter({
      name: name || describeFilter(parsed),
      olx_url: parsed.url,
      api_query: apiQuery,
      location_id: parsed.locationId,
      location_name: parsed.locationName,
      scope: 'city',
      chat_id: String(ctx.chat.id),
    });
    const filter = repo.getFilter(id, ctx.chat.id);
    await reply(
      ctx,
      `➕ Added <b>#${id} ${esc(filter.name)}</b>\n` +
        `Only cars in ${esc(parsed.locationName)} are included. Use /scope ${id} nearby to include nearby districts too.`
    );
    try {
      await checker.checkFilter(filter);
    } catch (err) {
      repo.recordFailure(id, err.message);
      await reply(ctx, `First check failed (${esc(err.message)}). It will retry automatically on the next run.`);
    }
  }

  bot.command(['start', 'help'], (ctx) => reply(ctx, HELP));

  bot.command('add', async (ctx) => {
    const [url, ...nameParts] = String(ctx.match ?? '').trim().split(/\s+/);
    if (!url) return reply(ctx, 'Send: /add &lt;olx link&gt; [name]');
    await addFilter(ctx, url, nameParts.join(' ').trim());
  });

  const pendingUrls = new Map();
  bot.on('message:text', async (ctx, next) => {
    const url = ctx.message.text.match(/https?:\/\/(www\.)?olx\.in\/\S+/)?.[0];
    if (!url || ctx.message.text.startsWith('/')) return next();
    const key = Math.random().toString(36).slice(2, 10);
    pendingUrls.set(key, url);
    setTimeout(() => pendingUrls.delete(key), 30 * 60_000);
    await reply(ctx, 'Track this OLX search?', {
      reply_markup: new InlineKeyboard().text('➕ Track it', `add:${key}`).text('Cancel', 'cancel'),
    });
  });

  bot.callbackQuery(/^add:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const url = pendingUrls.get(ctx.match[1]);
    await ctx.editMessageReplyMarkup();
    if (!url) return reply(ctx, 'That link expired. Send it again.');
    pendingUrls.delete(ctx.match[1]);
    await addFilter(ctx, url, '');
  });

  bot.callbackQuery('cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Cancelled.');
  });

  bot.command('list', (ctx) => {
    const filters = repo.listFilters(ctx.chat.id);
    if (!filters.length) return reply(ctx, 'No filters yet. Send an OLX search link to start.');
    const lines = filters.map((f) => {
      const icon = !f.active ? '⏸' : f.fail_count >= 3 ? '⚠️' : '✅';
      const checked = f.last_checked ? `checked ${timeAgo(f.last_checked.replace(' ', 'T') + 'Z')}` : 'not checked yet';
      const where = f.scope === 'city' ? f.location_name : `${f.location_name} + nearby`;
      return `${icon} <b>#${f.id} ${esc(f.name)}</b>\n    ${esc(where)} · ${f.last_count ?? '–'} matching now · ${checked}\n    <a href="${esc(f.olx_url)}">open on OLX</a>`;
    });
    return reply(ctx, lines.join('\n\n'));
  });

  bot.command('latest', (ctx) => {
    const [idStr, nStr] = String(ctx.match ?? '').trim().split(/\s+/);
    const filter = repo.getFilter(parseInt(idStr, 10), ctx.chat.id);
    if (!filter) return reply(ctx, 'Send: /latest &lt;id&gt; [n]. See ids with /list');
    const n = Math.min(Math.max(parseInt(nStr, 10) || 5, 1), 20);
    const rows = repo.latest(filter.id, n);
    if (!rows.length) return reply(ctx, 'No cars saved for this filter yet.');
    const lines = rows.map((l) => {
      const bits = [formatPrice(l.price), l.km != null ? `${l.km.toLocaleString('en-IN')} km` : null, l.fuel, l.locality || l.city, timeAgo(l.posted_at)]
        .filter((x) => x && x !== 'undefined');
      return `• <a href="${esc(l.url)}">${esc(l.title)}</a>\n   ${esc(bits.join(' · '))}`;
    });
    return reply(ctx, `<b>#${filter.id} ${esc(filter.name)} · latest ${rows.length}</b>\n\n${lines.join('\n')}`);
  });

  bot.command('scope', (ctx) => {
    const [idStr, scope] = String(ctx.match ?? '').trim().split(/\s+/);
    if (!['city', 'nearby'].includes(scope)) return reply(ctx, 'Send: /scope &lt;id&gt; city  or  /scope &lt;id&gt; nearby');
    const ok = repo.setScope(parseInt(idStr, 10), ctx.chat.id, scope);
    if (!ok) return reply(ctx, 'Filter not found. See /list');
    return reply(ctx, scope === 'city'
      ? `#${idStr} now only alerts for cars in the chosen city.`
      : `#${idStr} now includes nearby districts. Cars already listed there are saved quietly on the next check; only newer ones alert.`);
  });

  for (const [cmd, active] of [['pause', false], ['resume', true]]) {
    bot.command(cmd, (ctx) => {
      const id = idArg(ctx);
      if (!repo.setActive(id, ctx.chat.id, active)) return reply(ctx, `Send: /${cmd} &lt;id&gt;. See ids with /list`);
      return reply(ctx, active ? `▶️ #${id} resumed.` : `⏸ #${id} paused.`);
    });
  }

  bot.command('stop', (ctx) => {
    const filters = repo.listFilters(ctx.chat.id);
    let count = 0;
    for (const f of filters) {
      if (f.active) {
        repo.setActive(f.id, ctx.chat.id, false);
        count++;
      }
    }
    return reply(ctx, `⏹ Paused ${count} active filter(s). Notifications are stopped. Use /list to see them or /resume &lt;id&gt; to restart.`);
  });

  bot.command('remove', (ctx) => {
    const filter = repo.getFilter(idArg(ctx), ctx.chat.id);
    if (!filter) return reply(ctx, 'Send: /remove &lt;id&gt;. See ids with /list');
    return reply(ctx, `Stop tracking <b>#${filter.id} ${esc(filter.name)}</b> and delete its saved cars?`, {
      reply_markup: new InlineKeyboard().text('🗑 Yes, remove', `rm:${filter.id}`).text('Keep', 'cancel'),
    });
  });

  bot.callbackQuery(/^rm:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const ok = repo.deleteFilter(parseInt(ctx.match[1], 10), ctx.chat.id);
    await ctx.editMessageText(ok ? `🗑 Removed #${ctx.match[1]}.` : 'Already removed.');
  });

  bot.command('reset', async (ctx) => {
    const [idStr, nStr] = String(ctx.match ?? '').trim().split(/\s+/);
    const filter = repo.getFilter(parseInt(idStr, 10), ctx.chat.id);
    if (!filter) return reply(ctx, 'Send: /reset &lt;id&gt; [n]. See ids with /list');
    const n = Math.min(Math.max(parseInt(nStr, 10) || 5, 1), config.maxAlertsPerRun);
    const count = repo.resendNewest(filter.id, n);
    if (!count) return reply(ctx, 'No cars saved for this filter yet.');
    await reply(ctx, `🔁 Sending the newest ${count} car(s) of #${filter.id} ${esc(filter.name)} again…`);
    await checker.sendPending(filter);
  });

  bot.command('check', async (ctx) => {
    if (state.running) return reply(ctx, 'A check is already running. Results will arrive shortly.');
    await reply(ctx, '🔄 Checking OLX now…');
    const s = await checker.runCycle();
    if (s.skipped) return;
    return reply(ctx, s.blocked
      ? '🚫 OLX blocked the request. Checks are backing off for a while.'
      : `Done. ${s.checked} filter(s) checked, ${s.newCars} new car(s)${s.failed ? `, ${s.failed} failed` : ''}.`);
  });

  bot.command('status', (ctx) => {
    const t = repo.totals();
    const fmt = (d) => (d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '–');
    const lines = [
      '<b>Status</b>',
      `Active filters: ${t.active_filters}`,
      `Cars tracked: ${t.listings}`,
      `Alerts in last 24 h: ${t.alerts_24h}`,
      `Last check: ${fmt(state.lastRunAt)}${state.running ? ' (running now)' : ''}`,
      `Next check: ${fmt(state.nextRunAt)}`,
      state.blockedStreak ? `🚫 Blocked by OLX, backing off ${backoffMinutes()} min` : '✅ Not blocked',
      `Proxy: ${currentProxy() ?? 'none (direct)'}${config.proxyUrls.length > 1 ? ` (1 of ${config.proxyUrls.length} in rotation)` : ''}`,
    ];
    return reply(ctx, lines.join('\n'));
  });

  bot.catch((err) => log.error('Bot error:', err.error?.message ?? err.message));

  bot.api
    .setMyCommands([
      { command: 'add', description: 'Track an OLX search link' },
      { command: 'list', description: 'Your filters' },
      { command: 'latest', description: 'Last cars found for a filter' },
      { command: 'check', description: 'Check OLX now' },
      { command: 'status', description: 'Checker health' },
      { command: 'scope', description: 'City only or include nearby' },
      { command: 'pause', description: 'Pause a filter' },
      { command: 'resume', description: 'Resume a filter' },
      { command: 'stop', description: 'Stop all notifications' },
      { command: 'remove', description: 'Stop tracking a filter' },
      { command: 'reset', description: 'Send the newest cars again' },
      { command: 'help', description: 'How it works' },
    ])
    .catch((err) => log.warn('setMyCommands failed:', err.message));

  return bot;
}

function describeFilter(parsed) {
  const filter = new URL(parsed.url).searchParams.get('filter') ?? '';
  const parts = Object.fromEntries(
    filter.split(',').filter(Boolean).map((p) => {
      const m = p.match(/^([a-z]+)_(eq|between|max|min)_(.+)$/);
      return m ? [m[1], { op: m[2], val: m[3] }] : [p, null];
    })
  );
  const pretty = (s) => s.split('_and_').map((v) => v.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).join('/');
  const range = (p, fmt) => {
    if (!p) return null;
    if (p.op === 'between') {
      const [a, b] = p.val.split('_to_');
      return a === b ? fmt(a) : `${fmt(a)}–${fmt(b)}`;
    }
    return `${p.op === 'max' ? '≤' : '≥'}${fmt(p.val)}`;
  };
  const lakh = (v) => `₹${Math.round(Number(v) / 100000)}L`;
  const bits = [
    parts.model ? pretty(parts.model.val) : parts.make ? pretty(parts.make.val) : 'Cars',
    range(parts.year, (v) => v),
    range(parts.price, lakh),
    parts.mileage ? range(parts.mileage, (v) => `${Math.round(Number(v) / 1000)}k km`) : null,
    parsed.locationName,
  ];
  return bits.filter(Boolean).join(' · ');
}
