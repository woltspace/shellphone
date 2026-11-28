---
name: lodge-phone
description: Set up Lodge Phone for your human: shellphone as their own phone app for their own wolts, one chat per wolt, on their lodge, behind their Cloudflare login. Use when your human asks for Lodge Phone, a Telegram replacement, or "shellphone for my wolts".
---

# Lodge Phone

Your human's own phone app for talking to their wolts. Each wolt is a chat. Messages go into the wolt's
session the way Telegram's do (the lodge starts or resumes it), and a wolt's `notify` comes back into
its chat. `/sessions`, `/new`, `/wolt NAME`, `/kill` work as on Telegram; answer a list with its number.

## Before you start (ask your human)
1. **Their email**: the one their Cloudflare login uses. Only that email gets in.
2. **The address**: a name under their lodge's domain, e.g. `https://lodgephone.<their apps domain>`.
3. **Team domain and AUD**: Cloudflare Zero Trust > Access > Applications, the app covering that address:
   its AUD tag (64 hex characters) and the team domain (`NAME.cloudflareaccess.com`).
   These are not secret, but never guess them. Without them the phone refuses to open (on purpose).

## Set it up
From a checkout of shellphone (this repo):

```bash
python3 lodgephone/setup.py up --owner THEIR_EMAIL --name THEIR_NAME \
  --team TEAM.cloudflareaccess.com --aud AUD --url https://lodgephone.THEIR_DOMAIN
```

It is safe to run again: it adds only what is missing (a new wolt, say). Then ask your human to
**restart the lodge once** (`woltspace restart`): the lodge starts connectors when it starts. You never
restart the lodge yourself.

## Check it
1. Your human opens the address on their phone, logs in with their email, adds it to the home screen.
2. They send a message in your chat: you get it in a new session; answer with
   `notify --to shellphone:<your name>`.
3. `/sessions` in any chat lists sessions.

## What not to do
- Never print `<wolts_dir>/.space/shellphone/keys.json` or the app's `.access.env`.
- Don't add other people: this phone is for one person. Group chats are shellphone rooms, not this.
- Files from `notify --file` are not carried yet (the connector says "refused"); text and voice notes are.
