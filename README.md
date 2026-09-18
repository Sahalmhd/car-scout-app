# Car Scout

A Telegram bot that watches OLX car searches for you.
When a new car is posted that matches your search, the bot sends you a message.

## What you need

- Node.js 20.12 or newer
- A Telegram account

## Setup

**1. Install packages**

```bash
npm install
```

**2. Make a Telegram bot**

- Open Telegram and message [@BotFather](https://t.me/BotFather).
- Send `/newbot` and follow the steps.
- BotFather gives you a **token**. Copy it.

**3. Create the `.env` file**

```bash
cp .env.example .env
```

Open `.env` and paste your token:

```
BOT_TOKEN=123456:ABC...
```

**4. Start the bot**

```bash
npm start
```

**5. Allow your chat**

- Open your bot in Telegram and send `/start`.
- The bot replies with your **chat ID**.
- Put it in `.env`:

```
ALLOWED_CHAT_IDS=123456789
```

For more than one person, separate the IDs with commas. Group chat IDs start with `-`.

- Stop the bot (Ctrl+C) and start it again with `npm start`.

Now the bot is ready.

## How to use it

1. Go to **olx.in** and open **Cars**.
2. Choose a city and set your filters (brand, model, year, price…).
3. Copy the link from the address bar.
4. Send the link to the bot and tap **➕ Track it**.

The bot saves the cars that are already listed. It does **not** send alerts for them.
After that, you get a message for **every new car** that matches.

The bot checks OLX every 20 minutes.

You can also add a link with a name:

```
/add https://www.olx.in/... Swift under 5L
```

## Commands

| Command | What it does |
|---|---|
| `/list` | Show your searches and their numbers (#1, #2…) |
| `/latest 1` | Show the last 5 cars for search #1 |
| `/latest 1 20` | Show the last 20 cars for search #1 |
| `/check` | Check OLX right now |
| `/scope 1 nearby` | Also show cars from nearby districts |
| `/scope 1 city` | Show cars from the chosen city only |
| `/pause 1` | Stop alerts for search #1 |
| `/resume 1` | Start alerts again for search #1 |
| `/remove 1` | Delete search #1 |
| `/status` | See if the bot is working well |
| `/help` | Show help |

## Icons in `/list`

- ✅ Working
- ⏸ Paused
- ⚠️ Failing (check the link on OLX)

## Settings (`.env`)

| Setting | Default | Meaning |
|---|---|---|
| `BOT_TOKEN` | – | Token from BotFather (required) |
| `ALLOWED_CHAT_IDS` | – | Chats that can use the bot |
| `CHECK_INTERVAL_MIN` | 20 | Minutes between checks |
| `JITTER_MAX_MIN` | 3 | Extra random minutes added to each wait |
| `DELAY_MIN_SEC` | 10 | Shortest pause between searches in one check |
| `DELAY_MAX_SEC` | 30 | Longest pause between searches in one check |
| `MAX_ALERTS_PER_RUN` | 15 | Most alerts sent for one search in one check |

## Keep it running

The bot only works while it is running. If your computer sleeps, it stops.
To keep it running in the background, use pm2:

```bash
npx pm2 start ecosystem.config.cjs
npx pm2 logs car-scout     # see logs
npx pm2 stop car-scout     # stop
```

## Test an OLX link

This checks if the bot can read an OLX search, without using Telegram:

```bash
npm run probe -- "https://www.olx.in/...your link..."
```

## Problems

- **"This bot is private"**: your chat ID is not in `ALLOWED_CHAT_IDS`. Add it and restart.
- **"BOT_TOKEN is missing"**: add the token to `.env`.
- **"Blocked by OLX"**: the bot waits longer and tries again by itself. Just wait.
- **Error about `better-sqlite3`**: run `npm rebuild better-sqlite3`.

Your data is saved in `data/cars.db`.
