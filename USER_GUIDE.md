# Car Scout – User Guide

Car Scout is a Telegram bot. It watches OLX for you and sends a message when a new car is posted that matches your search.

You don't need to open OLX again and again. The bot checks every 20 minutes.

---

## 1. Add a search

1. Open **olx.in** in your browser.
2. Go to **Cars** and choose a **city**.
3. Set your filters: brand, model, year, price, fuel…
4. Copy the link from the address bar.
5. Paste the link in the bot chat.
6. Tap **➕ Track it**.

The bot replies:

> ✅ Tracking started · #1 … 120 cars currently match.

**#1** is the number of your search. You use this number in the commands below.

The cars already on OLX are saved quietly. You only get messages for **new** cars.

**Give your search a name (optional):**

```
/add <olx link> Swift under 5 lakh
```

---

## 2. New car alerts

When a new car is posted, you get a message with:

- a photo of the car
- the price, year, km, fuel and place
- an **Open on OLX** button

Tap the button to see the full ad and call the seller.

The bot checks OLX about **every 20 minutes**, so an alert can come up to 20–25 minutes after the ad is posted.

---

## 3. Commands

In the commands below, change `1` to your search number.

| Command | What it does |
|---|---|
| `/list` | Show all your searches and their numbers |
| `/latest 1` | Show the last 5 cars for search #1 |
| `/latest 1 20` | Show the last 20 cars for search #1 |
| `/check` | Check OLX right now |
| `/scope 1 nearby` | Also show cars from nearby districts |
| `/scope 1 city` | Show cars from your city only |
| `/pause 1` | Stop alerts for search #1 for now |
| `/resume 1` | Start alerts again for search #1 |
| `/remove 1` | Delete search #1 |
| `/reset 1` | Send the 5 newest cars of search #1 again (good for testing) |
| `/reset 1 10` | Send the 10 newest cars again (max 15) |
| `/status` | See if the bot is working |
| `/help` | Show help |

You can also tap the **menu button (/)** next to the message box to see all commands.

---

## 4. Icons in `/list`

| Icon | Meaning |
|---|---|
| ✅ | Working |
| ⏸ | Paused |
| ⚠️ | Having problems. Open the link on OLX to check it still works. |

---

## 5. Tips

- **Use filters.** A search like "Kozhikode · Maruti · 2016+ · under ₹5 lakh" gives you useful alerts. A search for "all cars in India" sends too many messages.
- **Don't add the same thing twice.** If search #2 already includes everything in search #1, you get every car two times.
- **Change a search:** make a new link on OLX, add it, then `/remove` the old one.
- **Going on a break?** Use `/pause` instead of `/remove`, so you keep your search.

---

## 6. Common questions

**I added a link but got no car messages.**
That is normal. Cars already on OLX are not sent. Wait for new ads, or type `/latest 1` to see the cars the bot found.
To see what an alert looks like, type `/reset 1`.

**The bot says "That is not an OLX search link".**
Copy the link from a **search results page** on olx.in (a list of cars), not a single ad.

**The bot says "This bot is private".**
Your chat is not allowed yet. Send your chat ID to the person who runs the bot.

**I got a message "…and 12 more new cars".**
The bot sends at most 15 cars at a time. Type `/latest 1 20` to see the rest.

**No alerts for a long time.**
Type `/status`.
- ✅ **Not blocked**: the bot is fine. No new cars matched your search yet.
- 🚫 **Blocked**: OLX is blocking the bot for a while. It tries again by itself.
- No reply at all: the bot is stopped. Tell the person who runs it.
