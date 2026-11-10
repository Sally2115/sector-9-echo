SECTOR-9: ЭХО — ADMIN UPDATE

Replace these files in the GitHub repository:
- server.js                 -> repository root
- public/index.html         -> public/index.html
- public/app.js             -> public/app.js
- public/style.css          -> public/style.css

Then in Render -> your service -> Environment add:
ADMIN_TELEGRAM_ID = your numeric Telegram user ID

Get the numeric ID from a trusted Telegram ID lookup bot (for example, @userinfobot).
Do not put BOT_TOKEN here; keep the existing BOT_TOKEN and DATABASE_URL unchanged.
Commit the files and wait for Render deploy. Existing game_saves are preserved; new admin tables are created automatically.

Admin features in this update:
- player list with Telegram ID/name/username and online status (90-second heartbeat)
- player profile and save inspection
- ban/unban
- edit stats, inventory and clues
- unlock/lock chapters and set current chapter
- reset save
- maintenance mode with a player-facing message
- admin audit log

Important: use PostgreSQL DATABASE_URL for persistent player metadata, bans, maintenance state and audit logs. Without PostgreSQL, fallback memory storage resets when the server restarts.
