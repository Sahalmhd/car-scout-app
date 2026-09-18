import { InlineKeyboard } from 'grammy';
import { log, sleep } from './log.js';

const SEND_GAP_MS = 1500;

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const formatPrice = (p) => (p == null ? 'Price not listed' : `₹ ${Number(p).toLocaleString('en-IN')}`);

export function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function listingCaption(l, filter) {
  const specs = [
    l.km != null ? `${l.km.toLocaleString('en-IN')} km` : null,
    l.fuel,
    l.transmission,
    l.owner ? `${l.owner} owner` : null,
  ].filter(Boolean);
  const place = [l.locality, l.city].filter((x) => x && x !== 'undefined').join(', ');
  const lines = [
    `🚗 <b>NEW · ${esc(l.title)}</b>`,
    `<b>${formatPrice(l.price)}</b>`,
    specs.length ? esc(specs.join(' · ')) : null,
    place ? `📍 ${esc(place)}` : null,
    `👤 ${l.is_dealer ? 'Dealer' : 'Individual'}${l.seller_name ? ` · ${esc(l.seller_name)}` : ''}`,
    l.posted_at ? `🕒 Posted ${timeAgo(l.posted_at)}` : null,
    filter ? `🔎 #${filter.id} ${esc(filter.name)}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

export function createNotifier(bot) {
  async function sendListing(chatId, l, filter) {
    const caption = listingCaption(l, filter);
    const reply_markup = new InlineKeyboard().url('Open on OLX', l.url);
    if (l.image_url) {
      try {
        await bot.api.sendPhoto(chatId, l.image_url, { caption, parse_mode: 'HTML', reply_markup });
        await sleep(SEND_GAP_MS);
        return;
      } catch (err) {
        log.warn(`Photo send failed for ad ${l.ad_id}, falling back to text: ${err.message}`);
      }
    }
    await bot.api.sendMessage(chatId, caption, {
      parse_mode: 'HTML',
      reply_markup,
      link_preview_options: { is_disabled: true },
    });
    await sleep(SEND_GAP_MS);
  }

  async function sendText(chatId, html) {
    try {
      await bot.api.sendMessage(chatId, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (err) {
      log.error(`Telegram send failed to ${chatId}: ${err.message}`);
    }
  }

  return { sendListing, sendText };
}
