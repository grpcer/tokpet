# Tokpet

> Desktop pet that surfaces your real-time AI usage / quota / balance across providers.

Companion service (Node.js) that runs on your machine, talks to each AI provider, normalizes the data, and exposes a single `GET /state` JSON endpoint. The Tokpet hardware (or any client) polls that endpoint to render a live status display.

## Provider architecture

Providers are organized by **how the vendor exposes usage data**:

| Mode                | Data shape                                                        | Examples                                            |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| **`subscription/`** | Rolling-window quotas (5 h / 7 d / monthly) with reset timestamps | Claude.ai Pro / Max, Codex, OpenAI Plus, Cursor     |
| **`api-key/`**      | Cumulative spend / credit balance                                 | Anthropic API, OpenAI API, Gemini API, DeepSeek API |
| **`relay/`**        | Custom billing per gateway                                        | OpenRouter, Together, KeyAI                         |

Each provider implements the `Provider` interface in [`src/protocol/provider.ts`](src/protocol/provider.ts). Adding a new vendor only requires creating one directory under `src/providers/<mode>/<id>/` and adding one import to `src/providers/registry.ts`.

## Status

🚧 Early development. Currently wired up:

- ✅ `subscription/claude` — reads OAuth token from macOS Keychain, calls undocumented `GET /api/oauth/usage`, returns 5 h + 7 d utilization
- 🚧 Server + aggregator + TTL cache + `/state` JSON contract

The only public stability guarantee is the `/state` JSON schema — see [`src/protocol/state.ts`](src/protocol/state.ts).

## Develop

```bash
npm install
npm run dev          # tsx watch src/index.ts
curl http://localhost:4717/state | jq
```

Build & run release:

```bash
npm run build
npm start
```

## License

MIT
