# Hive Desktop (Tauri)

A native desktop app for Hive with system notifications.

## Prerequisites

**Rust is required** to build Tauri apps:

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Restart your shell, then verify
rustc --version
cargo --version
```

## Development

```bash
# Start Tauri dev (starts Vite + Rust backend)
bun run tauri:dev
```

This opens a desktop window with:
- Hot reload from Vite dev server
- System notifications on task completion
- Native window chrome

## Build

```bash
# Build release app
bun run tauri:build
```

Outputs:
- macOS: `src-tauri/target/release/bundle/dmg/Hive_0.1.0.dmg`
- macOS app: `src-tauri/target/release/bundle/macos/Hive.app`

## Features

- ✅ System notifications when agents complete tasks
- ✅ Native window with proper title bar
- ✅ Smaller bundle than Electron (~10MB vs ~150MB)
- ✅ Uses system webview (Safari on macOS)

## Configuration

- `src-tauri/tauri.conf.json` — Window size, CSP, etc.
- `src-tauri/Cargo.toml` — Rust dependencies
- `src-tauri/src/lib.rs` — Plugin initialization

## API Proxy in Production

The desktop app connects to Hive at `http://localhost:3000`. For production deployments, you'd configure a production API URL in `vite.config.ts` or use environment variables.

## Notifications

When an agent completes or fails a task, the desktop app shows a system notification:

```
@gpt completed
Task finished in #dev
```

This uses `@tauri-apps/plugin-notification` which gracefully degrades in the browser (no notifications).