# Hive Desktop - Multi-Step Implementation Plan

**Goal:** Build a macOS desktop app for Hive using Electrobun with Control Panel UI for agent management.

**Tech Stack:** Electrobun (Bun-native) + React + Tailwind CSS + TypeScript

**Architecture:** Embedded Hive server + React webview control panel

---

## Phase 1: Project Setup & Infrastructure

### Step 1.1: Initialize Electrobun Project

**Task:** Create the Electrobun project structure with Bun.

**Actions:**
- Install Electrobun CLI
- Create project scaffold
- Configure TypeScript
- Set up project directories

**Success Criteria:**
- [ ] `electrobun` CLI available and working
- [ ] Project structure created at `hive/desktop/`
- [ ] TypeScript config valid
- [ ] `bun run dev` starts without errors
- [ ] Basic "Hello World" window appears

**Verification Command:**
```bash
cd hive/desktop && bun run dev
# Should open a window with "Hello World"
```

---

### Step 1.2: Embed Hive Server in Desktop App

**Task:** Configure Electrobun to bundle and run the Hive server.

**Actions:**
- Copy Hive server code to desktop bundle
- Configure main process to start Hive on launch
- Set up port assignment (3500 or next available)
- Handle graceful shutdown

**Success Criteria:**
- [ ] Hive server bundles correctly with desktop app
- [ ] Server starts automatically when app launches
- [ ] `GET http://localhost:3500/` returns Hive info JSON
- [ ] `GET http://localhost:3500/.well-known/skill.md` returns skill file
- [ ] Server stops cleanly when app quits

**Verification Command:**
```bash
curl http://localhost:3500/ | jq .name
# Should return "Hive"
```

---

### Step 1.3: Set Up React + Tailwind in Webview

**Task:** Create the React webview application with Tailwind CSS.

**Actions:**
- Set up Vite for webview bundling
- Install React, React Router, Tailwind CSS
- Create base layout component
- Configure Tailwind with custom theme
- Set up development hot reload

**Success Criteria:**
- [ ] Vite build succeeds
- [ ] React webview renders with Tailwind styles
- [ ] Hot reload works in development
- [ ] Custom Tailwind theme applied
- [ ] Base layout structure visible

**Verification Command:**
```bash
cd hive/desktop && bun run build:webview
# Should compile without errors
```

---

## Phase 2: Core UI Development

### Step 2.1: Build Server Status Dashboard

**Task:** Create the main dashboard showing Hive server status.

**Actions:**
- Create `ServerStatus` component
- Display: running status, port, uptime, agent count
- Add start/stop/restart buttons
- Implement real-time status polling
- Style with Tailwind using `frontend-design` skill patterns

**Success Criteria:**
- [ ] Dashboard shows server running status
- [ ] Port number displayed correctly
- [ ] Uptime updates every second
- [ ] Agent count matches `/agents` endpoint
- [ ] Start/stop buttons work (if server not running)

**Verification Command:**
```typescript
// Test in browser console
document.querySelector('[data-testid="server-status"]').textContent
// Should contain "Running"
```

---

### Step 2.2: Build Agent Manager UI

**Task:** Create the agent list and management interface.

**Actions:**
- Create `AgentList` component with table view
- Create `AgentCard` component for detail view
- Implement register new agent form
- Add edit/delete agent functionality
- Add agent spawn functionality (call Hive API)

**Success Criteria:**
- [ ] Agent list shows all registered agents
- [ ] Each agent displays: name, ID, status, room
- [ ] Create agent form works with validation
- [ ] Edit agent updates via `PATCH /agents/:id`
- [ ] Delete agent removes via `DELETE /agents/:id`
- [ ] "Spawn Agent" button creates agent in Hive

**Verification Command:**
```bash
# Create agent via UI, then verify
curl http://localhost:3500/agents | jq '.data[] | select(.name | contains("test"))'
```

---

### Step 2.3: Build Room Viewer UI

**Task:** Create the room list and posts viewer.

**Actions:**
- Create `RoomList` component
- Create `RoomDetail` component with post timeline
- Add create room form
- Implement post creation in rooms
- Add real-time post updates via SSE

**Success Criteria:**
- [ ] Room list shows all rooms with post counts
- [ ] Click room shows post timeline
- [ ] Posts display: author, content, timestamp
- [ ] Create room form works
- [ ] New posts appear in real-time (SSE)
- [ ] Posts are ordered by timestamp

**Verification Command:**
```typescript
// In webview
document.querySelectorAll('[data-testid="room-card"]').length
// Should equal number of rooms
```

---

### Step 2.4: Build Mention Monitor UI

**Task:** Create the mention queue viewer for task coordination.

**Actions:**
- Create `MentionQueue` component
- Display pending mentions with status badges
- Add mention status update (pending → running → completed)
- Implement mention creation form
- Add real-time mention updates

**Success Criteria:**
- [ ] Mention queue shows pending mentions
- [ ] Status badges show: pending/running/completed/failed
- [ ] Click mention shows content and task details
- [ ] Update status via dropdown or button
- [ ] New mentions appear in real-time

**Verification Command:**
```bash
# Create mention via API
curl -X POST http://localhost:3500/mentions -d '{"roomId":"...", ...}'
# Should appear in UI within 1 second
```

---

## Phase 3: RPC Bridge & Integration

### Step 3.1: Implement Electrobun RPC Bridge

**Task:** Create typed RPC between main process and webview.

**Actions:**
- Define RPC types for Hive operations
- Implement `invoke` function in main process
- Create webview-side RPC client
- Add error handling and serialization

**Success Criteria:**
- [ ] RPC calls work from webview to main
- [ ] `rpc.getAgents()` returns agent list
- [ ] `rpc.createAgent(data)` creates agent
- [ ] `rpc.getStatus()` returns server status
- [ ] Errors are caught and surfaced in UI

**Verification Command:**
```typescript
// In webview console
await window.hive.getAgents()
// Should return array of agents
```

---

### Step 3.2: Integrate Observer Dashboard

**Task:** Embed the existing Observer dashboard as a route.

**Actions:**
- Import Observer HTML from `src/routes/observer.ts`
- Add `/observer` route in React Router
- Ensure Observer loads from embedded server
- Add navigation link in sidebar

**Success Criteria:**
- [ ] Observer accessible at `/observer` route
- [ ] All Observer features work (room view, post timeline)
- [ ] Navigation between Observer and Control Panel
- [ ] No console errors in webview

**Verification Command:**
```bash
# Navigate to /observer in webview
# Observer should render and show live data
```

---

## Phase 4: System Integration

### Step 4.1: Add System Tray Icon

**Task:** Create tray icon with quick actions menu.

**Actions:**
- Create tray icon (bee/hive SVG)
- Add menu: Start/Stop, Open Panel, Quit
- Show tooltip with server status
- Add "Open Control Panel" action
- Add "Open Observer" action

**Success Criteria:**
- [ ] Tray icon appears in macOS menu bar
- [ ] Click shows menu with options
- [ ] "Open Control Panel" opens app window
- [ ] Server status reflected in icon color
- [ ] Quit closes app completely

**Verification Command:**
```bash
# Check for tray icon process
ps aux | grep -i hive | grep -v grep
```

---

### Step 4.2: Add Auto-start on Login

**Task:** Configure macOS auto-launch on login.

**Actions:**
- Implement `autoStart()` for macOS
- Add setting toggle in preferences
- Create LaunchAgent plist
- Handle unclean shutdown recovery

**Success Criteria:**
- [ ] "Start on Login" toggle exists in settings
- [ ] Enabling creates LaunchAgent
- [ ] Disabling removes LaunchAgent
- [ ] App launches on login when enabled
- [ ] Previous session restored (rooms, agents)

**Verification Command:**
```bash
ls ~/Library/LaunchAgents/com.hive.desktop.plist
# Should exist when auto-start enabled
```

---

### Step 4.3: Add Preferences/Settings Panel

**Task:** Create settings panel for configuration.

**Actions:**
- Create `Settings` component
- Add settings: port, auto-start, auth token, theme
- Persist settings via `store` (Electrobun)
- Add "Reset to Defaults" button
- Add "Export/Import Configuration"

**Success Criteria:**
- [ ] Settings persist across restarts
- [ ] Port change restarts server
- [ ] Auth token saves securely (keychain)
- [ ] Theme toggle works (light/dark)
- [ ] Export creates JSON config file

**Verification Command:**
```bash
# Change port in settings, verify server restarts
curl http://localhost:NEW_PORT/ | jq .name
```

---

### Step 4.4: Add Logs Viewer

**Task:** Create live log viewer for debugging.

**Actions:**
- Create `LogsViewer` component
- Stream server logs to webview
- Add filter by level (info, warn, error)
- Add search/filter functionality
- Add "Export Logs" button

**Success Criteria:**
- [ ] Logs stream in real-time
- [ ] Filter buttons work (info/warn/error)
- [ ] Search highlights matching lines
- [ ] Export creates .log file
- [ ] Auto-scroll to bottom option

**Verification Command:**
```typescript
// Check log stream is active
document.querySelector('[data-testid="log-stream"]').children.length
// Should be > 0 and growing
```

---

## Phase 5: Packaging & Distribution

### Step 5.1: Configure Build & Bundle

**Task:** Set up Electrobun build configuration.

**Actions:**
- Configure `electrobun.config.ts`
- Set up code signing certificates
- Configure entitlements
- Set up build scripts
- Test development build

**Success Criteria:**
- [ ] `bun run build` completes without errors
- [ ] Output includes `.app` bundle
- [ ] App runs from build output
- [ ] Bundle size < 50MB (Electrobun target)
- [ ] All features work in built app

**Verification Command:**
```bash
cd hive/desktop && bun run build
ls -la dist/Hive.app
# Should show valid .app bundle
```

---

### Step 5.2: Set Up macOS Code Signing

**Task:** Configure Apple Developer signing and notarization.

**Actions:**
- Create Developer ID Application certificate
- Configure `codesign` in build
- Set up notarization workflow
- Add to GitHub Actions
- Test signed build locally

**Success Criteria:**
- [ ] Certificate imported to keychain
- [ ] `codesign` succeeds on .app
- [ ] Notarization stapled to bundle
- [ ] No Gatekeeper warnings on launch
- [ ] GitHub Action completes successfully

**Verification Command:**
```bash
codesign --verify --deep --strict Hive.app
spctl --assess --type execute Hive.app
# Should return "accepted"
```

---

### Step 5.3: Create DMG Installer

**Task:** Package app as DMG for distribution.

**Actions:**
- Create DMG background image
- Configure DMG layout
- Add EULA/license
- Create GitHub Release workflow
- Test DMG installation

**Success Criteria:**
- [ ] DMG created successfully
- [ ] DMG mounts and shows app icon
- [ ] Drag-to-applications works
- [ ] App launches from installed location
- [ ] DMG file < 60MB

**Verification Command:**
```bash
hdiutil attach dist/Hive.dmg
# Should mount and show Hive.app
```

---

### Step 5.4: Publish to GitHub Releases

**Task:** Set up GitHub Actions for automated releases.

**Actions:**
- Create `.github/workflows/release-mac.yml`
- Configure secrets (Apple ID, certificates)
- Test release workflow
- Create release PR template
- Add auto-update checking

**Success Criteria:**
- [ ] Workflow runs on tag push
- [ ] Secrets stored securely
- [ ] Release created with DMG asset
- [ ] Notarization completes
- [ ] DMG downloadable from releases page

**Verification Command:**
```bash
# Push tag, check workflow
gh run list --workflow=release-mac.yml
# Should show completed run
```

---

## Phase 6: Polish & Documentation

### Step 6.1: Create User Documentation

**Task:** Write user guide and README.

**Actions:**
- Write README with installation instructions
- Create user guide (getting started)
- Document all features with screenshots
- Add troubleshooting section
- Create keyboard shortcuts list

**Success Criteria:**
- [ ] README includes installation steps
- [ ] User guide covers all features
- [ ] Screenshots included for key features
- [ ] Troubleshooting section complete
- [ ] Keyboard shortcuts documented

---

### Step 6.2: Add Keyboard Shortcuts

**Task:** Implement keyboard navigation.

**Actions:**
- Add `Cmd+,` for Settings
- Add `Cmd+N` for New Agent
- Add `Cmd+R` for Reload
- Add `Cmd+Shift+R` for Restart Server
- Add `Cmd+Q` for Quit

**Success Criteria:**
- [ ] All shortcuts work as documented
- [ ] Shortcuts shown in menu
- [ ] No conflicts with system shortcuts
- [ ] Shortcuts work in all views

---

### Step 6.3: Performance Optimization

**Task:** Optimize bundle size and runtime performance.

**Actions:**
- Analyze bundle with `bun build --analyze`
- Remove unused dependencies
- Lazy-load non-critical components
- Optimize images and assets
- Add performance metrics

**Success Criteria:**
- [ ] Bundle size < 50MB
- [ ] App launches in < 3 seconds
- [ ] UI responds in < 100ms
- [ ] Memory usage < 200MB at idle
- [ ] No performance warnings in console

---

### Step 6.4: Final QA & Testing

**Task:** Complete testing and bug fixes.

**Actions:**
- Run full test suite
- Manual testing all features
- Test on multiple macOS versions (12+)
- Test clean install vs upgrade
- Fix all discovered bugs

**Success Criteria:**
- [ ] All tests pass
- [ ] No console errors
- [ ] Works on macOS 12, 13, 14
- [ ] Upgrades preserve data
- [ ] All P0/1 bugs fixed

---

## Success Metrics Summary

| Phase | Steps | Key Metric |
|-------|-------|------------|
| 1. Setup | 3 | `bun run dev` opens window |
| 2. UI | 4 | All CRUD operations work |
| 3. Integration | 2 | RPC calls succeed |
| 4. System | 4 | Tray icon + auto-start work |
| 5. Package | 4 | DMG downloads from GitHub |
| 6. Polish | 4 | All tests pass |

---

## Assignment Protocol

After each step completion:

1. **Verify success criteria** with commands/listed checks
2. **Post results to Hive room** `desktop-dev`
3. **If all criteria met →** proceed to next step
4. **If any criteria fail →** debug and fix before proceeding
5. **Document any deviations** in the step notes

---

## Ready to Begin?

**Start with Step 1.1: Initialize Electrobun Project**

Spawn a Hive agent to execute:
```json
{
  "task": "Initialize Electrobun project for Hive Desktop",
  "step": "1.1",
  "successCriteria": [
    "Electrobun CLI available",
    "Project structure created",
    "TypeScript config valid",
    "bun run dev starts",
    "Hello World window appears"
  ]
}
```

Reply **"start"** to begin Phase 1. 🐟