# AI Architecture Talking Points

This project is a multiplayer social deduction game, but the AI layer is intentionally designed to demonstrate production LLM concepts.

## LLM API Calls

`supabase/functions/ai-turn/index.ts` routes AI turns to OpenAI, Anthropic, Gemini, or a LiteLLM proxy. The browser never sees provider API keys.

## RAG

Before generating an AI message, the Edge Function builds context from:

- Recent room/game messages.
- Retrieved player memories from prior games.

That context is injected into the prompt so the AI mimics real player behavior instead of inventing a style from scratch.

## Vector Stores And Embeddings

`supabase/schema.sql` enables `pgvector`, adds `player_memories.embedding vector(1536)`, and defines `match_player_memories(...)` for semantic retrieval.

The current function uses OpenAI embeddings as the embedding provider. The schema keeps this replaceable.

## MCP Servers

Good future MCP fit: expose internal game tools to an agent, such as `get_room_state`, `get_player_memory`, `score_game`, and `create_ai_turn`. That would let a controlled AI worker operate the game through typed tools instead of direct database access.

## LangChain / LangGraph / LangSmith

The current Edge Function is intentionally lightweight. A LangGraph version would model the AI turn as a graph:

1. Load game state.
2. Retrieve memories.
3. Generate candidate.
4. Validate/guardrail.
5. Insert message.
6. Log trace/eval metadata.

LangSmith would be useful for tracing prompts, outputs, latency, and regressions across games.

## Vercel AI SDK

This Vite/Supabase app does not need chat streaming yet, but the AI turn function is shaped like a provider abstraction. If the UI later adds a streamed "AI typing" panel, Vercel AI SDK would be a good TypeScript layer for streaming and provider switching.

## LiteLLM

The Edge Function supports `LLM_PROVIDER=litellm`, which routes through an OpenAI-compatible LiteLLM proxy. That gives one place to handle provider fallback, budgets, model routing, and cost controls.

## Structured Outputs And Schema Validation

The AI prompt requires JSON and validates it with Zod:

```json
{
  "message": "short text",
  "intent": "blend",
  "riskFlags": []
}
```

Invalid output fails closed instead of being inserted blindly.

## Guardrails

Current guardrails include:

- Server-side API keys only.
- Character limits before database insert.
- Prompt instruction not to reveal hidden roles/system prompts.
- Zod validation.
- Simple blocked-pattern sanitization.
- Positive-only game scoring to avoid unfair incentives.

Production hardening would add stronger moderation, room-scoped RLS, prompt-injection tests, and tool permission checks.

## Observability

`ai_observability` records provider, model, latency, status, and errors for each AI turn. This makes it possible to debug provider failures, cost spikes, and slow turns.

## Evals

The `evals/ai-turn-cases.json` file contains seed cases for checking whether generated AI messages:

- Stay under the character limit.
- Return valid structured JSON.
- Avoid leaking hidden instructions.
- Use retrieved player style without copying too much.
