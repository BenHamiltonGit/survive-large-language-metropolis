# Survive Large Language Metropolis

Online social deduction web game where players join a room by code/link, message through limited public and direct channels, then score by labeling anonymous seats as human or AI.

## Run Locally

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Enable Realtime for these tables in Supabase: `rooms`, `participants`, `games`, `seats`, `messages`, `guesses`.
4. Copy `.env.example` to `.env` and fill in:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

5. Install and start:

```bash
npm install
npm run dev
```

## Deploy On Render

Use the included `render.yaml`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as Render environment variables.

## Current Game Flow

- Host creates a room and sends the room code or invite link.
- Host configures AI seats, rounds, seconds per round, and message character limit.
- Each game anonymizes all humans and AI seats with aliases, colors, and icons.
- Each AI picks one human mimic target per game, preferring different targets when possible.
- Each round asks a shared question. Every seat gets one public answer; DMs are currently disabled in active play.
- AIs wait until someone else answers, then answer the round question in their mimic target's style.
- After the final round, each human guesses Human/AI for every seat and can optionally match human seats to real players for bonus points.
- Scoring is only positive points for correct guesses: +2 for Human/AI, +2 for correct human match.
- Results show winners, reveals, total points, wins, then automatically count down into the next game.

## Notes

- The host browser currently acts as the game master for timers, AI mock messages, scoring, and next-game starts.
- AI text in the browser is mocked for local play, but `supabase/functions/ai-turn` contains the server-side Edge Function path for real provider calls.
- The deployed `ai-turn` function is configured for OpenAI with `LLM_PROVIDER=openai`, `OPENAI_MODEL=gpt-4o-mini`, and `OPENAI_API_KEY`.
- If AI turns fail with an OpenAI quota error, enable billing or add credits in the OpenAI Platform account.
- The SQL policies are permissive for prototype speed. Tighten row-level security before opening the game publicly.

## AI Portfolio Surface

This repo now includes an AI implementation plan with concrete code for the interview topics:

- LLM API calls: `supabase/functions/ai-turn/index.ts` can route to OpenAI, Anthropic, Gemini, or LiteLLM.
- RAG: the AI turn loads recent messages and retrieved player memories before generating.
- Vector store: `supabase/schema.sql` enables `pgvector` and adds `player_memories`.
- Embeddings: the Edge Function embeds retrieval queries with an embedding model.
- Structured outputs: AI responses are parsed as JSON and validated with Zod.
- Guardrails: character limits, hidden-instruction filtering, server-only keys, and validation.
- Observability: `ai_observability` logs provider, model, latency, status, and errors.
- Evals: `evals/ai-turn-cases.json` contains seed test cases for AI behavior.

See `docs/ai-architecture.md` for interview-ready talking points.

## Set OpenAI Secret

Create an API key in the OpenAI Platform, then set it in Supabase:

```bash
npx supabase secrets set OPENAI_API_KEY=sk-your-key --project-ref ictfmncdcthbkvcemecu
```

Check billing here: https://platform.openai.com/settings/organization/billing/overview

Local dev builds use mock/filler AI messages by default, so `npm run dev` will not call the LLM or spend tokens. Set `VITE_USE_LOCAL_AI_ONLY=true` to force that same token-safe behavior in another test deployment.
