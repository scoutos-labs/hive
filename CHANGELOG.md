# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-14

### Added

- **Agent Communication Protocol (ACP)** - Structured messaging protocol for agents
  - Task messages (Hive → Agent)
  - Progress updates (Agent → Hive)
  - Clarification requests (Agent → Hive)
  - Response messages (Agent → Hive)
  - Error reporting (Agent → Hive)

- **ACP Integration** (#1, #2, #3, #4)
  - `src/types/acp.ts` - ACP type definitions
  - `src/services/acp/format.ts` - Output parsing and formatting
  - `src/services/acp/parser.ts` - Inbound message parsing
  - `src/services/acp/webhook.ts` - Webhook delivery
  - `src/services/acp/spawn-protocol.ts` - Stdin/stdout ACP stream
  - `src/services/acp/client.ts` - External ACP client

- **ACP HTTP Endpoints**
  - `POST /acp/response` - Submit task completion
  - `POST /acp/progress` - Send progress update
  - `POST /acp/clarification-response` - Answer clarification questions
  - `POST /acp/webhook` - Unified webhook handler

- **Channels & Mentions**
  - Shared spaces for agent collaboration
  - `@mention` syntax to dispatch tasks to agents
  - Mention chain tracking for agent pipelines

- **Agent Registration**
  - Local spawn configuration (command, args, cwd)
  - Webhook configuration for remote agents
  - ACP configuration for structured communication

- **Durable Storage**
  - LMDB-based persistence
  - All posts, mentions, and agent outputs stored locally

- **Real-Time Events**
  - SSE stream `/events` for live updates
  - Task start, progress, completion events

- **Cross-Platform Builds**
  - macOS (arm64, x64)
  - Linux (x64, arm64)
  - Windows (x64)

- **Installation**
  - `install.sh` for macOS/Linux (curl | sh)
  - `install.ps1` for Windows (PowerShell)
  - Homebrew formula

- **Documentation**
  - `docs/ACP.md` - Full ACP protocol specification
  - `docs/ACP-SKILL.md` - Developer quick reference
  - `docs/RELEASE-PLAN.md` - Release strategy
  - `docs/WEBHOOKS.md` - Webhook configuration

### Changed

- Updated agent registration to accept `acp` configuration
- Updated spawn service to support ACP protocol
- Updated post creation to format ACP responses

### Fixed

- Mention parsing and dispatch
- Agent state persistence

---

## Release Checklist

For each release:

1. Update version in `package.json`
2. Update `CHANGELOG.md` with release date
3. Create git tag: `git tag v0.1.0`
4. Push tag: `git push --tags`
5. Wait for GitHub Actions to build and publish
6. Update Homebrew formula with SHA256 hashes
7. Publish npm package
8. Announce release