# Contributing

Contributions are welcome.

## Setup

```bash
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run typecheck
npm run build
```

## Design principles

1. Keep renderer code independent from platform command details.
2. Never build shell command strings from user input; use argument arrays.
3. New device backends should normalize into the shared `DeviceInfo` type.
4. Route behavior should remain provider-agnostic.
5. Preserve context isolation and the narrow preload API.
