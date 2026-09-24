---
name: fise-quickstart
description: Use when the user asks to spin up, generate, or create a Fise chatbot and shareable chat link from a business website URL (e.g. "/fise-quickstart https://example.com" or "make a Fise chatbot for example.com"). Scans the given website, creates a phantom chatbot not tied to any real Fise account, and hands back a standalone /chat/:key link like the Kin Electrical one.
---

# Fise quickstart

Turns a bare website URL into a working, shareable Fise chatbot link — the same kind of link built for Kin Electrical (`https://fise-ai-platform.seb-slabbert1.workers.dev/chat/fise_...`) — with a single command, no manual dashboard steps.

## What it does

1. Calls the Fise Worker's admin quickstart API to create a chatbot for the given website. This chatbot is owned by a dedicated internal system account (`quickstart-phantom@fise.internal`) — not any real person's Fise login. It never appears in any dashboard and can't be reached by signing in anywhere. The only way to reach it is the `/chat/:key` link this skill hands back.
2. The API immediately kicks off the same website-scan/indexing pipeline the dashboard uses (crawl pages → embed into an OpenAI vector store).
3. Polls the status endpoint until the chatbot's status is `ready` (or reports a failure/timeout).
4. Reports the final `/chat/:key` link to the user.

## Prerequisites

This needs a bearer token the Worker checks against its `QUICKSTART_ADMIN_TOKEN` secret. It's read from the `FISE_QUICKSTART_TOKEN` environment variable.

- If `$FISE_QUICKSTART_TOKEN` is unset, stop and tell the user: add it as an environment variable named `FISE_QUICKSTART_TOKEN` under this environment's settings (Edit environment in the environment menu), then start a new session. Do not ask them to paste the token into chat, and don't try to work around a missing token by hardcoding one.
- The Worker base URL is `https://fise-ai-platform.seb-slabbert1.workers.dev`. If it's been redeployed under a different URL, ask the user rather than guessing.

## Steps

1. **Parse the input.** Take the website URL from the command argument (or ask for one if missing). The argument string may also carry shorthand overrides anywhere in it:
   - `cbn=<name>` — chatbot name (maps to the API's `name` field; also seeds `business_name` if the user hasn't given one separately)
   - `cbc=<#rrggbb>` — chatbot primary colour, a 6-digit hex code (maps to the API's `primary_colour` field)

   Strip these tokens out of the argument string before treating the remainder as the URL / business name. If `cbn` or `cbc` is missing, don't ask — let the API fall back to its own defaults (name derived from the domain, colour `#1769e0`).

2. **Create the chatbot:**
   ```bash
   curl -sS -X POST "https://fise-ai-platform.seb-slabbert1.workers.dev/api/admin/quickstart" \
     -H "content-type: application/json" \
     -H "Authorization: Bearer $FISE_QUICKSTART_TOKEN" \
     -d '{"website_url":"<url>","business_name":"<optional>","name":"<optional cbn value>","primary_colour":"<optional cbc value>"}'
   ```
   Response: `{"chatbotId":"...","publicKey":"...","chatLink":"..."}` or `{"error":"..."}`. On error, report it plainly and stop — don't retry blindly (e.g. an invalid/unsafe URL is a real 400, not a flake).

3. **Poll for completion** using the returned `chatbotId`:
   ```bash
   curl -sS "https://fise-ai-platform.seb-slabbert1.workers.dev/api/admin/quickstart/status?id=<chatbotId>" \
     -H "Authorization: Bearer $FISE_QUICKSTART_TOKEN"
   ```
   Response includes `status` (`setup` → `scanning` → `ready`, or `setup`/`failed` if the scan errored) and a nested `scan` object with `pagesFound`/`pagesProcessed`/`error`. Poll every ~5 seconds. Small sites (a handful of pages) typically finish in under a minute; give it up to ~5 minutes before telling the user it's taking unusually long (their site is likely large) rather than declaring failure — keep polling if `status` is still `scanning` and `scan.error` is null.
   - If `status` becomes `setup` with a `scan.error` set, the scan failed — report the error and stop.
   - Do not sleep in a way that blocks the whole turn for the full 5 minutes without checking in; check progress, report it briefly, and continue polling.

4. **Report the result.** Once `status` is `ready`, give the user the `chatLink` and mention it needs no login, opens like the Kin Electrical link (closed by default with the launcher, "Version 2.1" picker top-right — see the conversation history in this repo for that page's exact behavior if it needs to be reproduced elsewhere). Alongside the link, list the settings the chatbot was created with (see the table below), labelling each one "(recommended)" unless the user overrode it via `cbn`/`cbc` or an explicit request — e.g.:

   - Chatbot name — Assistant *(recommended, from domain)*
   - Primary colour — `#1769e0` *(recommended)*
   - Answer length — short *(recommended)*
   - Formality — friendly *(recommended)*
   - Opening size — large *(recommended)*
   - Files upload — allowed *(recommended)*
   - Voice input — allowed *(recommended)*
   - Lead capture — off *(recommended)*
   - Emoji — off *(recommended)*

   Only settings the quickstart API actually applies (see the table below) — don't invent settings that aren't real.

## Every setting quickstart applies

The `/api/admin/quickstart` endpoint hardcodes a fixed, opinionated set of chatbot settings — none of these except name/colour/greeting are currently overridable via the API body. Treat every one of them as "recommended" defaults when reporting to the user (`src/index.js`, `quickstartCreate`):

| Setting | Value | Overridable this way |
|---|---|---|
| Chatbot name | derived from domain, or `cbn=` | `name` / `cbn=` |
| Business name | derived from domain, or explicit | `business_name` |
| Primary colour | `#1769e0`, or `cbc=` | `primary_colour` / `cbc=` |
| Greeting | "Hi! How can I help you today?" | `greeting` (not currently exposed as a shorthand) |
| Answer length | short | fixed |
| Formality | friendly | fixed |
| Opening size (widget default size) | large | fixed |
| Allow file uploads | yes | fixed |
| Allow voice input | yes | fixed |
| Lead capture | off | fixed |
| Emoji in replies | off | fixed |
| Model | gpt-5-mini | fixed |
| Monthly message limit | 500 | fixed |

If the user asks to change one of the "fixed" rows, say plainly that quickstart doesn't expose it yet and that it would need either a direct database update (see Notes below) or a change to `quickstartCreate` in `src/index.js` to accept it as a body param — don't silently ignore the request or fake support for it.

## Notes

- Each run creates a brand-new chatbot row — there's no dedupe by URL. If the user reruns this for the same site, they'll get a second, independent link. Mention this only if it seems like they might not want a duplicate.
- These phantom chatbots aren't visible or manageable through the Fise dashboard at all (by design — see the conversation that created this skill for why). If the user wants to edit one later (name, greeting, colours, etc.), that requires a direct database update — there's no self-serve edit path for phantom bots yet. Say so rather than guessing at one.
- This intentionally reuses the exact same vector-store-creation and crawl/index pipeline the real dashboard "create chatbot" flow uses, just without that flow's one-chatbot-per-account cap and without requiring a login.
