Build and deploy a web app plus a bot that reacts to slash commands in a Discord server and acts on them.

The flow you're building:

An admin signs in to your web app and connects it to a Discord server (adds your bot and picks a channel it can post to).
Users run slash commands in Discord (for example /report <text> or /status). Discord sends each command to your interactions endpoint.
When an interaction arrives, your app processes it and acts: it records the command, applies a simple rule, responds in Discord, and mirrors a notification to a second channel (a Slack channel or a different Discord channel).
A dashboard, visible only after the admin logs in, shows a live log of every command and action, and lets the admin configure command behavior.
It's a small product, but a real one. Getting it working end-to-end on a live URL requires you to set up and connect several external services correctly — that integration work is the heart of this exercise.



Quick primer: what an "interaction" is
When a user runs a slash command (or clicks a button, submits a modal, etc.), Discord sends an HTTP POST with a JSON payload to the Interactions Endpoint URL you register — no always-on websocket bot required. Every request is signed with Ed25519 (X-Signature-Ed25519 / X-Signature-Timestamp), which you must verify, and Discord sends a PING (interaction type 1) when you set the endpoint that you must answer with a PONG. Interaction types you'll see: 1 PING, 2 APPLICATION_COMMAND (slash commands), 3 MESSAGE_COMPONENT (buttons/menus), 5 MODAL_SUBMIT. You must respond within ~3 seconds, or send a deferred acknowledgment and follow up after.



Core requirements (everyone must deliver these)
A deployed, publicly reachable web app (the Discord interactions endpoint cannot point at localhost).
A Discord application/bot (via the Developer Portal) with at least two slash commands registered.
A working interactions endpoint that handles those commands and records them.
The bot writes back: it responds in Discord for at least one command (a reply and/or a post to the configured channel).
The bot mirrors a notification to a second channel — a Slack Incoming Webhook or a separate Discord channel.
A dashboard (behind login) showing the command log, the actions taken, and command configuration.
A README.md that lets us run it locally and explains how you deployed it.


Stretch goals (raise your ceiling — aim here if you have the experience)
These are how stronger candidates distinguish themselves. You don't need all of them.

Configurable command rules in the UI rather than hard-coded behavior.
Interactive components (buttons on a message) that trigger a follow-up action — a second interaction type you also have to verify.
A modal form (/report opens a dialog) — another interaction type to handle.
An AI step: run the command text through an LLM to summarize, tag, or triage, and show it in the response and dashboard. (See "Using AI inside the app" below — keep it free.)
Multi-server support (each connected server isolated, with its own config).
Meaningful observability: structured logs, a visible history of failures and retries.


Quality bar — what "working" actually means
Treat this as something that will run unattended. That mindset is what we're grading. In particular:

It should not be foolable by forged or replayed requests — verify Discord's Ed25519 request signature on every request and answer the PING correctly. (Discord won't accept your endpoint at all unless you do this — but we'll also throw junk at it.)
It should not do the same thing twice if the same interaction is delivered more than once — dedup on the interaction id.
It should not silently lose an interaction if a downstream call (the mirror channel, the AI) or your own service is briefly unavailable.
It should respect Discord's ~3-second response window — defer and follow up for any slow work rather than timing out.
It must never expose secrets — bot token, application public key, mirror-channel URLs — not in the repo, not in client-side code, not in logs.
Note: Discord uses Ed25519 signatures rather than HMAC. It's well-documented and there are libraries for it (e.g. discord-interactions, tweetnacl) — verifying the signature is the price of admission for the endpoint, which is exactly why it's in the core.



Constraints
Everything must be free. No credit card, anywhere. A Discord app/bot is free via the Developer Portal with no card. If any service asks for card details, you've picked the wrong tier — switch.
Use any tech stack and language you're comfortable with. Full-stack means front end, back end, data, and deployment — all yours.
Deploy to a real public host.
Suggested free services (all have no-card free tiers)
Bot — Discord Developer Portal (free, no card). You'll also need a server you can add the bot to (a free personal server is fine).
Database — Neon or Supabase (free Postgres, no card).
Notifications (second channel) — a Slack Incoming Webhook URL or a separate Discord channel webhook (both are paste-a-URL, no card).
Hosting — Render, Vercel, Cloudflare, or Netlify (free tiers, no card).
AI (only if you do the AI stretch goal) — Google Gemini (via Google AI Studio) or Groq. Both give an API key on a free tier with no credit card. Do not use a paid LLM API for this exercise.


Deliverables (your submission)
A GitHub repository with all your code and a clear commit history.
The deployed URL, working and reachable when we open it.
A README.md covering: what the app does, how to run it locally, the environment variables it needs (provide a .env.example with no real secrets), and how/where you deployed it.
A way for us to test it — brief instructions, an invite to a test server (or how to add the bot to ours), and login for a throwaway admin account.
Your AI context/instruction files, exactly as you used them — e.g. CLAUDE.md, AGENTS.md, .cursorrules, or equivalent. If you didn't use any, say so in AI_NOTES.md.
AI_NOTES.md (about one page) — see below.


Using AI — and what to tell us about it
You should use AI tools throughout. We want to understand how you worked with them, because that's a real skill we care about. In AI_NOTES.md, briefly cover:

Which AI tools and models you used, and roughly how you split work between you and the AI.
2–3 key decisions you made yourself (architecture, data model, a service choice) and why.
The single hardest bug or wrong turn the AI led you into — what it got wrong, how you noticed, and how you fixed it. (This is the part we read most closely. Be specific and honest.)
What you'd improve or add with more time.
Optional: include one short prompt or transcript excerpt for the trickiest part if you think it's illuminating. Don't dump full logs.



How we'll evaluate
We weigh, roughly in this order:

Does it actually work end-to-end on the live URL — run a slash command and watch it record, respond in Discord, and mirror to the second channel — not just the happy first step.
Reliability and security of the integration — how it behaves under the unhappy paths in the quality bar (forged/unsigned request, duplicate interaction, downstream briefly down, slow work).
Code quality and clarity — structure, readability, sensible choices, a clean repo.
Depth — how far into the stretch goals you got, and how well.
Quality of your AI collaboration — what AI_NOTES.md and your context files reveal about how you think and debug.


considerations
use nextjs, nodejs,typescript and not use any in code
write all the types at types folder for nextjs for all services in their respective folders.

create  Moniter,Boat,ingetion server. postgress(neon) as db,redis as durable queue using redis streams( use the redis with pending entry list with retry and DLQ logic).
we will provide all the .env keys for slack,discord,redis,neon just update .env.example,create those servervices for versel deployment.

create the interaction endpoint for discord as it receive the interaction messages as the initial window for replay is 3 seconds. immediately send the acknowledgement to discord and save ttl 15 seconds for that token to send the next iteraction to quque.
create separate queue for interaction and boat messages to run the jobs in seprate threads for bot.
as user interactions should save to neon db as logs  as it should be fanout for writing it to slack, boat and the db. if boat or slack is down it should retry with backoff and exponential growth.

if any erros happens add them to dlq by using redis strems. use the versel lamda for processing the quque for boat and writing interaction to neondb in batches of 20.
use redis Streams as durable queue with pending entry list with retry and DLQ logic with fanout queue for slack, boat,moniter server and also create log server to log all the logs to the neon db.
while processing boat request send the immedite response processing using type InteractionResponseType and for interaction update the expiry time 15 seconds after sending ack within 3 seconds. handle 401 error at logs

we are using free tier for discord and slack. so dont use any paid service.
any doubts please ask.

