# Fise Outreach Studio

Finds small and medium South African businesses, researches and qualifies them, and prepares
personalised, branded outreach for the Fise AI website chatbot: email (main channel), AI phone
calls via Vapi, SMS, and prepared WhatsApp / contact-form / social messages you send by hand.

This app is separate from the Fise Worker in the repo root and has its own `package.json`.

## Run it locally

Requirements: **Node 22.13 or newer** (including 24). The database uses Node's built-in SQLite, so nothing needs compiling and no Python or Visual Studio tools are needed on Windows.

On Windows PowerShell, if `npm` is blocked with "running scripts is disabled", run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

```bash
cd outreach-studio
npm install
npx playwright install chromium   # only needed for the chat test and render check
cp .env.example .env              # (Windows: copy .env.example .env) then fill in the keys you have
npm run build && npm start        # app on http://localhost:3100  (or: npm run dev)
npm run worker                    # in a second terminal: background jobs
```

The worker runs searches, research, chat tests, sending, calls, follow-ups and reply polling.
Without it, jobs wait in the queue. The database is a single SQLite file at `data/outreach.db`. Node prints an "ExperimentalWarning: SQLite" line; that is expected.

Everything works in stages, so you can start with only some keys:

| You have | You can |
|---|---|
| nothing | add prospects by hand, research their sites, generate template emails, preview, export HTML/text |
| `ANTHROPIC_API_KEY` | tailored copy, research summaries, comparisons, call scripts, reply classification |
| `GOOGLE_PLACES_API_KEY` | Lead Finder searches |
| `RESEND_API_KEY` + DNS verified | send approved batches |
| `IMAP_*` | replies stop sequences automatically |
| `VAPI_*` | AI calls (test mode first) |
| `TWILIO_*` | SMS |

Checks:

```bash
npm test               # 44 unit/integration tests (fixture websites, mocked APIs, real headless Chromium)
npm run typecheck
npm run render:check   # screenshots a sample email at Gmail / Outlook / Apple Mail widths, images on and off → data/render-check/
```

## Going live (production checklist)

1. **Host it on your domain over HTTPS**, e.g. `https://outreach.fise.co.za`, on any Node host with
   a persistent disk (a VPS, Railway, Render or Fly.io). Set `PUBLIC_BASE_URL` to it: hosted images,
   unsubscribe links and landing pages are served from there. Serverless hosts don't suit this app
   (SQLite + a long-running worker).
2. Set `APP_PASSWORD` and a long random `APP_SECRET`.
3. **Sending subdomain**: add e.g. `mail.fise.co.za` in Resend, publish its SPF/DKIM records, add
   `_dmarc.fise.co.za` (`v=DMARC1; p=none; rua=mailto:dmarc@fise.co.za`), then run
   **Settings → Sending domain → Check**. Sending is blocked until this passes.
4. Resend webhook → `https://YOUR_DOMAIN/api/webhooks/resend` with events *bounced, complained,
   delivered*; put its signing secret in `RESEND_WEBHOOK_SECRET`.
5. `ALLOWED_LINK_DOMAINS`: your domains that email links may use (e.g. `fise.co.za`). Point the
   demo link in Settings at one of them; the checker blocks off-domain links.
6. Fill in **Settings → Fise & sender details**, especially the physical address.
7. Vapi: create an assistant whose system prompt is only `{{callBrief}}` (choose voice/model there),
   buy or import a number, and set the `VAPI_*` values. Set the server URL secret to
   `VAPI_WEBHOOK_SECRET`. Make a test call to your own number before turning test mode off.
8. Twilio (optional): set the messaging webhook for inbound SMS to `https://YOUR_DOMAIN/api/webhooks/twilio`.

## How it works

- **Lead Finder**: Google Places API (New) Text Search, up to 60 results per keyword × city, with a
  cost estimate before running and a monthly budget cap. Results are de-duplicated by place ID and
  website domain. Only `place_id` is stored permanently; other Places fields sit in a cache that
  expires (30 days by default) and is refreshed through Place Details. Google's terms restrict
  caching of Places content, so review them for your use.
- **Qualification**: working website (not parked, not social-only), platform detection
  (WordPress, Wix, Shopify, Squarespace, Webflow, Duda, Google Sites, …) with an installability
  flag, and size signals (review count, shared listings, team size, owner-run, corporate/chain
  signals). The result is a 0–100 fit score with a plain-English reason. Thresholds are sliders in
  Settings.
- **Crawler**: identifies as `FiseOutreachBot` (with an info page at `/bot`), obeys robots.txt,
  waits 1.5 s between requests per host, fetches at most 6 pages, and refuses private IP addresses.
  Emails are syntax- and MX-checked, never guessed, and every contact detail keeps its source page.
- **Chat test**: only for leads you tick. It sends one question, and the approval is used up by
  that single test. Observations feed the "why Fise" note, which only states what was observed.
- **Email**: React Email, table layout, inline CSS, system fonts, one hosted image, a VML
  "bulletproof" button for Outlook, at most 3 links, a plain-text part, and a footer with sender,
  address, why they're getting it, and one-click unsubscribe (`List-Unsubscribe` +
  `List-Unsubscribe-Post`). A checker enforces every rule before an email can be batched.
- **Sending**: nothing goes out without a batch you approve after previewing it. Every send
  re-checks the do-not-contact list. Sending runs Mon–Fri 08:00–17:00 SAST with a warm-up
  (20/day, +10/week), per-domain caps and random 90–300 s spacing, and pauses automatically on a
  complaint or a bounce rate above 3%. No tracking pixels or redirect links: replies are what's counted.
- **Calls**: the assistant says it's automated in its first sentence. Calls happen only in
  business hours, never on SA public holidays (Easter-based ones included), under a daily cap. Test mode rings only
  your number. "No / stop / remove me" opts the lead out on every channel, even if the classifier
  disagreed.
- **Compliance**: one global do-not-contact list (with import), right-to-erasure buttons, and
  consent-first mode (below).

### POPIA consent-first mode (on by default)

POPIA section 69 treats email, SMS and automated calls as electronic direct marketing. It lets you
approach a non-customer **once** to ask for consent. So by default the first email asks
permission, and follow-ups, AI calls and SMS only go to prospects whose consent is marked
**granted** (set automatically when they reply with interest or book on a call, or by you on the
lead page). Switch it off in Settings only on legal advice. This app helps you comply but is not
legal advice.
