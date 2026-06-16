Original prompt: Build a web game where anonymous human players and AI seats message publicly and directly across limited timed rounds, then players score by labeling identities as human/AI and optionally matching human identities to real players. AIs mimic one assigned human per game using past messages. Games should show winners, track ongoing points/wins, and auto-count down into the next game.

## Progress

- Created an initial static web prototype plan.
- Pivoted from local hot-seat prototype to Supabase-backed online multiplayer after user clarified this must be room-code/link multiplayer.
- Added Vite app setup, Render static deploy config, Supabase schema, and README setup notes.
- Implemented room create/join, lobby settings, host game start, synced seats/messages/guesses, scoring, results reveal, and automatic next-game countdown.
- Host browser currently acts as game master; AI text is mocked and delayed slightly into the round so it can inspect early target messages.
- Added AI portfolio layer: Supabase Edge Function scaffold for OpenAI/Anthropic/Gemini/LiteLLM calls, pgvector memory schema, observability logs, Zod structured output validation, guardrail hooks, eval seed cases, and architecture talking points.
- Deployed `ai-turn` Edge Function to Supabase project `ictfmncdcthbkvcemecu`.
- Set Supabase Edge Function config secrets `LLM_PROVIDER=openai` and `OPENAI_MODEL=gpt-4o-mini`.
- Set `OPENAI_API_KEY` as a Supabase Edge Function secret.
- Live Edge Function smoke test reached OpenAI successfully, but OpenAI returned a quota/billing error.
- Browser AI flow now invokes `ai-turn` first and falls back to local mock messages if the Edge Function fails.
- AI browser-hosted turns now use deterministic, realistic pacing instead of sending every public and direct message in one burst. Public messages and DMs are spread across each round with duplicate-send locks.
- Local dev builds now force mock/filler AI messages and skip the `ai-turn` Edge Function, so testing does not spend LLM tokens. `VITE_USE_LOCAL_AI_ONLY=true` can force that behavior in other test deployments.
- Completed a full retro desktop UI pass across connect, lobby, gameplay, guessing, and results screens. All major surfaces now use the same chunky window/titlebar style, and the wording says character limit instead of message limit.
- Improved the lobby: added invite-link visibility, copy room code/link actions, lobby stats, host/you labels, start-readiness messaging, disabled start until 2 human players, automatic settings save on start, and double-start protection.
- Made live round UI behave like a real desktop: player monitor, identities, public board, DM launcher, and DM threads are draggable windows with minimize, close, taskbar restore, and z-index focus behavior.
- Invite links now open a join-room modal that requires the player to enter a display name before they are added to the room. Existing participants with a matching saved participant id still load their room directly.
- Key rule decisions from user:
  - End-of-game labeling is the core mechanic.
  - Round count is host configurable.
  - Each round refreshes limited message allowances.
  - Points are only positive points for a player's own correct guesses.
  - No points for fooling other players.
  - AIs choose one human mimic target per game, prefer distinct targets when multiple AIs exist, and reroll next game.
  - AIs can use historical messages from previous games for the chosen target.
  - Message character limit should be small to control cost and preserve deduction tension.

## TODO

- Add Supabase Edge Function for real LLM AI messages.
- Enable OpenAI billing/add credits so `ai-turn` can receive successful model responses instead of quota errors.
- Replace permissive prototype RLS policies with room-membership-aware policies.
- Add host handoff or server-side cron/worker so the game continues if the host closes the tab.
