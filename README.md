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

🚧 Early development. Working today:

- ✅ Setup page + config store — pick an access mode and provider in the browser, test the connection, and the provider is activated and persisted to `~/.tokpet/config.json` (restored on restart).
- ✅ `subscription/claude` — reuses your local Claude Code login, calls the undocumented `GET /api/oauth/usage`, returns 5 h + 7 d utilization.
- ✅ Server + aggregator + TTL cache + `/state` JSON contract.

`api-key` and `relay` modes are scaffolded but have no providers wired up yet.

The only public stability guarantee is the `/state` JSON schema — see [`src/protocol/state.ts`](src/protocol/state.ts).

## Install

**Homebrew (recommended)**

```bash
brew install grpcer/tokpet/tokpet
brew services start tokpet     # runs in the background, restarts on login
tokpet open                    # configure providers in your browser
```

**npm**

```bash
npm install -g tokpet
tokpet service install         # background launchd service, restarts on login
tokpet open
```

Either way, Tokpet opens a setup page where you pick how a provider exposes
usage (subscription / API key / relay), choose a provider, and hit **Test** —
on success it activates and starts appearing in `GET /state`. Choices are saved
to `~/.tokpet/config.json` and restored on the next launch.

The setup/configuration API is bound to loopback only; `GET /state` stays
reachable on your LAN so the device (or any client) can poll it.

Manage the service:

|        | Homebrew                     | npm                        |
| ------ | ---------------------------- | -------------------------- |
| start  | `brew services start tokpet` | `tokpet service install`   |
| stop   | `brew services stop tokpet`  | `tokpet service uninstall` |
| status | `brew services info tokpet`  | `tokpet service status`    |

## Troubleshooting

Device stuck on "open the console to add a provider", or not showing up after you move it to a new network? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

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

[Apache-2.0](LICENSE)
