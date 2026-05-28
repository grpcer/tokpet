# Contributing to Tokpet

Thanks for your interest in helping out. Tokpet aims to be a small,
focused open-source project; please read this guide before opening an
issue or pull request.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
By participating you agree to abide by its terms.

## Project Layout

```
src/
├── protocol/        Public types: Provider, Usage, State.
├── providers/       One folder per vendor, grouped by access mode.
│   ├── subscription/
│   ├── api-key/
│   └── relay/
├── aggregator/      Combines provider results into a State snapshot.
├── cache/           TTL utilities.
├── server/          Fastify HTTP entry exposing GET /state.
└── utils/           Shared helpers (keychain, time formatting, ...).
```

## Adding a New Provider

Tokpet supports three access modes — `subscription`, `api-key`, and
`relay` — and every vendor maps to exactly one of them.

1. Pick the mode that matches how the vendor exposes usage data.
2. Copy `src/providers/_template/<mode>.ts` to
   `src/providers/<mode>/<provider-id>/index.ts`.
3. Update `id`, `displayName`, `configSchema`, `isReady`, and `fetch`.
4. Add the new provider to `ALL_PROVIDERS` in
   `src/providers/registry.ts`.
5. Add at least one unit test under `test/`.

Provider ids are lowercase kebab-case and globally unique (e.g.
`openai-api`, `openrouter`, `claude`).

## Development

Requirements: Node.js 20 LTS or newer.

```bash
npm install
npm run dev          # tsx watch
npm run typecheck    # tsc --noEmit
npm run lint
npm run test
npm run build
```

Before sending a pull request, please run:

```bash
npm run typecheck && npm run lint && npm run test
```

CI runs the same matrix against Node 20 and Node 22 on Linux.

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<optional body>

<optional footer(s)>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`,
`build`, `ci`. Breaking changes go in the footer as
`BREAKING CHANGE: ...`.

Examples:

```
feat(providers): add openrouter relay provider
fix(claude): handle missing seven_day window gracefully
docs(readme): describe the three provider modes
```

## Pull Requests

- One logical change per PR.
- Update or add tests covering your change.
- Run `npm run lint` and `npm run typecheck` locally.
- Reference any related issue with `Closes #N`.

## Versioning

Tokpet uses [Semantic Versioning](https://semver.org/). The public
`/state` JSON schema is the only stability surface; the
`STATE_PROTOCOL_VERSION` constant in `src/protocol/state.ts` is bumped on
any breaking schema change. Internal refactors do not bump it.

## License

By contributing you agree that your contributions will be licensed under
the [Apache License 2.0](./LICENSE).
