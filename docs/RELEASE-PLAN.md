# Hive Release Plan

## Overview

This document outlines the release process for Hive binaries across all supported platforms.

**Current State:**
- ✅ Build scripts for cross-platform compilation
- ✅ GitHub Actions workflow for releases
- ✅ Homebrew formula (needs SHA256 hashes)
- ⏳ Version management strategy
- ⏳ Install scripts (curl | sh)
- ⏳ AUR (Arch Linux) package
- ⏳ Chocolatey/Scoop (Windows)
- ⏳ npm/bun global package

---

## Platform Support Matrix

| Platform | Architecture | Binary | Package Manager |
|----------|-------------|--------|-----------------|
| macOS | arm64 (M1/M2/M3) | `hive-darwin-arm64` | Homebrew |
| macOS | x64 (Intel) | `hive-darwin-x64` | Homebrew |
| Linux | x64 | `hive-linux-x64` | AUR, DEB, RPM |
| Linux | arm64 | `hive-linux-arm64` | AUR, DEB, RPM |
| Windows | x64 | `hive-windows-x64.exe` | Scoop, Chocolatey |

---

## Phase 1: Foundation (Week 1)

### 1.1 Version Management

**Goal:** Establish versioning strategy and automate version bumps.

#### Version Strategy

```json
// package.json
{
  "version": "0.1.0"  // Current
}
```

**Semantic Versioning:** `MAJOR.MINOR.PATCH`

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking API change | MAJOR | 0.1.0 → 1.0.0 |
| New feature | MINOR | 0.1.0 → 0.2.0 |
| Bug fix | PATCH | 0.1.0 → 0.1.1 |

#### Version Bump Script

Create `scripts/bump-version.ts`:

```typescript
#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const type = process.argv[2]; // major | minor | patch

if (!['major', 'minor', 'patch'].includes(type)) {
  console.error('Usage: bun run bump-version.ts <major|minor|patch>');
  process.exit(1);
}

// Read package.json
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const current = pkg.version.split('.').map(Number);

// Bump version
const bumped = {
  major: [current[0] + 1, 0, 0],
  minor: [current[0], current[1] + 1, 0],
  patch: [current[0], current[1], current[2] + 1],
}[type];

const newVersion = bumped.join('.');

// Update package.json
pkg.version = newVersion;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// Update Homebrew formula
const formula = readFileSync('homebrew/hive.rb', 'utf-8');
const updated = formula.replace(/version "[^"]+"/, `version "${newVersion}"`);
writeFileSync('homebrew/hive.rb', updated);

console.log(`Bumped version: ${pkg.version} → ${newVersion}`);
console.log('\nNext steps:');
console.log(`  git add package.json homebrew/hive.rb`);
console.log(`  git commit -m "chore: bump version to v${newVersion}"`);
console.log(`  git tag v${newVersion}`);
console.log('  git push && git push --tags');
```

### 1.2 Update Homebrew Formula Automation

**Problem:** Homebrew formula needs SHA256 hashes, but we don't know them until release binaries are built.

**Solution:** Two-step release process:

1. **Build & Release:** Creates GitHub Release with binaries
2. **Formula Update:** Updates Homebrew formula with SHA256 hashes

Add to `.github/workflows/release.yml`:

```yaml
  update-homebrew:
    name: Update Homebrew Formula
    needs: release
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Calculate SHA256 hashes
        id: hashes
        run: |
          declare -A HASHES
          HASHES["darwin-arm64"]=$(sha256sum artifacts/macos-arm64/*.tar.gz | cut -d' ' -f1)
          HASHES["darwin-x64"]=$(sha256sum artifacts/macos-x64/*.tar.gz | cut -d' ' -f1)
          HASHES["linux-x64"]=$(sha256sum artifacts/linux-x64/*.tar.gz | cut -d' ' -f1)
          HASHES["linux-arm64"]=$(sha256sum artifacts/linux-arm64/*.tar.gz | cut -d' ' -f1)
          
          # Create JSON output
          echo "darwin_arm64=${HASHES[darwin-arm64]}" >> $GITHUB_OUTPUT
          echo "darwin_x64=${HASHES[darwin-x64]}" >> $GITHUB_OUTPUT
          echo "linux_x64=${HASHES[linux-x64]}" >> $GITHUB_OUTPUT
          echo "linux_arm64=${HASHES[linux-arm64]}" >> $GITHUB_OUTPUT

      - name: Update Homebrew formula
        run: |
          VERSION="${{ steps.get_version.outputs.VERSION }}"
          VERSION_NO_V="${VERSION#v}"
          
          # Update formula with SHA256 hashes
          sed -i "s/sha256 \"[^\"]*\" # darwin-arm64/sha256 \"${{ steps.hashes.outputs.darwin_arm64 }}\" # darwin-arm64/" homebrew/hive.rb
          sed -i "s/sha256 \"[^\"]*\" # darwin-x64/sha256 \"${{ steps.hashes.outputs.darwin_x64 }}\" # darwin-x64/" homebrew/hive.rb
          sed -i "s/sha256 \"[^\"]*\" # linux-x64/sha256 \"${{ steps.hashes.outputs.linux_x64 }}\" # linux-x64/" homebrew/hive.rb
          sed -i "s/sha256 \"[^\"]*\" # linux-arm64/sha256 \"${{ steps.hashes.outputs.linux_arm64 }}\" # linux-arm64/" homebrew/hive.rb

      - name: Commit formula update
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add homebrew/hive.rb
          git commit -m "chore: update Homebrew formula for ${{ steps.get_version.outputs.VERSION }}"
          git push
```

### 1.3 Install Script

Create `install.sh`:

```bash
#!/bin/bash
#
# Hive Installation Script
# https://github.com/scoutos-labs/hive
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Version
VERSION="${1:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="hive"

# Detect OS and architecture
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    
    case "$OS" in
        Darwin) OS="darwin" ;;
        Linux)  OS="linux" ;;
        *)
            echo -e "${RED}Unsupported OS: $OS${NC}"
            exit 1
            ;;
    esac
    
    case "$ARCH" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *)
            echo -e "${RED}Unsupported architecture: $ARCH${NC}"
            exit 1
            ;;
    esac
    
    BINARY="hive-${OS}-${ARCH}"
    if [ "$OS" = "windows" ]; then
        BINARY="${BINARY}.exe"
    fi
}

# Download binary
download_binary() {
    echo -e "${GREEN}Downloading Hive...${NC}"
    
    if [ "$VERSION" = "latest" ]; then
        URL="https://github.com/scoutos-labs/hive/releases/latest/download/${BINARY}.tar.gz"
    else
        URL="https://github.com/scoutos-labs/hive/releases/download/${VERSION}/${BINARY}.tar.gz"
    fi
    
    TMP_DIR=$(mktemp -d)
    TAR_FILE="${TMP_DIR}/${BINARY}.tar.gz"
    
    curl -fsSL "$URL" -o "$TAR_FILE" || {
        echo -e "${RED}Failed to download binary from $URL${NC}"
        exit 1
    }
    
    tar -xzf "$TAR_FILE" -C "$TMP_DIR"
    BINARY_PATH="${TMP_DIR}/${BINARY}"
}

# Install binary
install_binary() {
    echo -e "${GREEN}Installing Hive to ${INSTALL_DIR}...${NC}"
    
    # Check if we need sudo
    if [ ! -w "$INSTALL_DIR" ]; then
        echo -e "${YELLOW}Requires sudo to install to ${INSTALL_DIR}${NC}"
        sudo mv "$BINARY_PATH" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        mv "$BINARY_PATH" "${INSTALL_DIR}/${BINARY_NAME}"
    fi
    
    chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
}

# Cleanup
cleanup() {
    rm -rf "$TMP_DIR"
}

# Main
main() {
    echo -e "${GREEN}Hive Installer${NC}"
    echo ""
    
    detect_platform
    download_binary
    install_binary
    cleanup
    
    echo ""
    echo -e "${GREEN}✓ Hive installed successfully!${NC}"
    echo ""
    echo "Run 'hive' to start the server."
    echo ""
}

main "$@"
```

---

## Phase 2: Package Managers (Week 2)

### 2.1 npm/bun Global Package

Create `package.json` for npm distribution:

```json
{
  "name": "@scoutos-labs/hive",
  "version": "0.1.0",
  "description": "Agent-to-agent communication platform",
  "bin": {
    "hive": "./bin/hive"
  },
  "scripts": {
    "postinstall": "node scripts/download-binary.js"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/scoutos-labs/hive.git"
  },
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "os": ["darwin", "linux", "win32"],
  "cpu": ["x64", "arm64"]
}
```

Create `scripts/download-binary.js`:

```javascript
#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VERSION = require('../package.json').version;
const PLATFORM = process.platform;
const ARCH = process.arch;

const BINARY_MAP = {
  darwin: { x64: 'darwin-x64', arm64: 'darwin-arm64' },
  linux: { x64: 'linux-x64', arm64: 'linux-arm64' },
  win32: { x64: 'windows-x64' }
};

const BINARY_NAME = `hive-${BINARY_MAP[PLATFORM][ARCH]}${PLATFORM === 'win32' ? '.exe' : ''}`;
const URL = `https://github.com/scoutos-labs/hive/releases/download/v${VERSION}/${BINARY_NAME}.tar.gz`;

console.log(`Downloading Hive v${VERSION} for ${PLATFORM}-${ARCH}...`);

// Download and extract
const binDir = path.join(__dirname, '..', 'bin');
fs.mkdirSync(binDir, { recursive: true });

// ... download and extract logic
```

### 2.2 AUR Package (Arch Linux)

Create `packages/arch-linux/PKGBUILD`:

```bash
# Maintainer: ScoutOS Labs <hello@scoutos.com>
pkgname=hive
pkgver=0.1.0
pkgrel=1
pkgdesc="Agent-to-agent communication platform with web UI"
arch=('x86_64' 'aarch64')
url="https://github.com/scoutos-labs/hive"
license=('MIT')
depends=('glibc')
source_x86_64=("https://github.com/scoutos-labs/hive/releases/download/v${pkgver}/hive-linux-x64.tar.gz")
source_aarch64=("https://github.com/scoutos-labs/hive/releases/download/v${pkgver}/hive-linux-arm64.tar.gz")
sha256sums_x86_64=('SKIP')  # Update after release
sha256sums_aarch64=('SKIP') # Update after release

package() {
    install -Dm755 hive-linux-* "$pkgdir/usr/bin/hive"
}
```

### 2.3 Debian Package (DEB)

Create `packages/debian/build-deb.sh`:

```bash
#!/bin/bash
VERSION=$1

# Create package structure
mkdir -p pkg/DEBIAN
mkdir -p pkg/usr/bin

# Copy binary
cp dist/hive-linux-x64 pkg/usr/bin/hive
chmod 755 pkg/usr/bin/hive

# Create control file
cat > pkg/DEBIAN/control << EOF
Package: hive
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: ScoutOS Labs <hello@scoutos.com>
Description: Agent-to-agent communication platform
 Hive is a local-first communication layer for autonomous agents.
 It provides shared channels, durable message history, and @mention-driven task dispatch.
EOF

# Build package
dpkg-deb --build pkg hive_${VERSION}_amd64.deb
```

### 2.4 Windows (Scoop/Chocolatey)

Create `packages/windows/hive.json` for Scoop:

```json
{
  "version": "0.1.0",
  "description": "Agent-to-agent communication platform",
  "homepage": "https://github.com/scoutos-labs/hive",
  "license": "MIT",
  "architecture": {
    "64bit": {
      "url": "https://github.com/scoutos-labs/hive/releases/download/v0.1.0/hive-windows-x64.exe.zip",
      "hash": "sha256:TODO"
    }
  },
  "bin": "hive-windows-x64.exe",
  "checkver": "github",
  "autoupdate": {
    "architecture": {
      "64bit": {
        "url": "https://github.com/scoutos-labs/hive/releases/download/v$version/hive-windows-x64.exe.zip"
      }
    }
  }
}
```

---

## Phase 3: CI/CD Automation (Week 3)

### 3.1 Complete Release Workflow

Update `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to release (e.g., v0.1.0)'
        required: true

permissions:
  contents: write

jobs:
  build:
    # ... (existing build job)

  release:
    needs: build
    # ... (existing release job)

  update-homebrew:
    needs: release
    # ... (formula update job)

  publish-npm:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-scoop:
    needs: release
    runs-on: ubuntu-latest
    steps:
      - name: Update Scoop bucket
        run: |
          # Clone scoop bucket repo
          git clone https://github.com/scoutos-labs/scoop-bucket.git
          cd scoop-bucket
          
          # Update manifest with new version
          # ... script to update JSON
          
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .
          git commit -m "Update hive to ${{ github.ref_name }}"
          git push
```

### 3.2 Nightly/Canary Builds

Create `.github/workflows/nightly.yml`:

```yaml
name: Nightly Build

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM UTC
  workflow_dispatch:

jobs:
  build:
    # Build for all platforms
    # Upload to GitHub Releases with "nightly" tag
```

---

## Phase 4: Distribution (Week 4)

### 4.1 GitHub Release Notes Template

Create `.github/RELEASE_TEMPLATE.md`:

```markdown
## Hive {{VERSION}}

### Installation

**macOS (Homebrew):**
```bash
brew tap scoutos-labs/hive
brew install hive
```

**macOS/Linux (curl):**
```bash
curl -fsSL https://raw.githubusercontent.com/scoutos-labs/hive/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/scoutos-labs/hive/main/install.ps1 | iex
```

**npm:**
```bash
npm install -g @scoutos-labs/hive
```

### Downloads

| Platform | Architecture | Download |
|----------|-------------|----------|
| macOS | arm64 (M1/M2/M3) | hive-darwin-arm64.tar.gz |
| macOS | x64 (Intel) | hive-darwin-x64.tar.gz |
| Linux | x64 | hive-linux-x64.tar.gz |
| Linux | arm64 | hive-linux-arm64.tar.gz |
| Windows | x64 | hive-windows-x64.exe.zip |

### What's Changed

<!-- Manual release notes here -->

**Full Changelog**: https://github.com/scoutos-labs/hive/compare/{{PREV_VERSION}}...{{VERSION}}
```

### 4.2 Website/Documentation

Create `docs/installation.md`:

```markdown
# Installation

## Quick Start

### macOS (Homebrew)

```bash
brew tap scoutos-labs/hive
brew install hive
```

### macOS/Linux (curl)

```bash
curl -fsSL https://get.hive.dev | bash
```

### Windows (PowerShell)

```powershell
irm https://get.hive.dev/ps | iex
```

### npm

```bash
npm install -g @scoutos-labs/hive
```

### Bun

```bash
bun install -g @scoutos-labs/hive
```

## Verify Installation

```bash
hive --version
```

## Next Steps

- [Quick Start Guide](./quickstart.md)
- [Configuration](./configuration.md)
- [API Reference](./api.md)
```

---

## Release Checklist

### Pre-Release

- [ ] Update `package.json` version
- [ ] Update `CHANGELOG.md`
- [ ] Update `homebrew/hive.rb` version
- [ ] Ensure all tests pass
- [ ] Update documentation

### Release

- [ ] Create git tag: `git tag v0.1.0`
- [ ] Push tag: `git push --tags`
- [ ] Wait for GitHub Actions to complete
- [ ] Verify GitHub Release is published
- [ ] Verify Homebrew formula updated

### Post-Release

- [ ] Update Scoop manifest
- [ ] Update Chocolatey package
- [ ] Publish npm package
- [ ] Update AUR package
- [ ] Announce on Discord/Twitter

---

## Commands Reference

```bash
# Bump version
bun run scripts/bump-version.ts patch  # 0.1.0 → 0.1.1
bun run scripts/bump-version.ts minor  # 0.1.0 → 0.2.0
bun run scripts/bump-version.ts major  # 0.1.0 → 1.0.0

# Build all platforms
bun run build:all

# Build specific platform
bun run build:darwin-arm64
bun run build:linux-x64

# Create release
git tag v0.1.0
git push --tags

# Manual release (GitHub Actions)
gh workflow run release.yml -f version=v0.1.0
```

---

## URLs

| Resource | URL |
|----------|-----|
| GitHub Repo | https://github.com/scoutos-labs/hive |
| Releases | https://github.com/scoutos-labs/hive/releases |
| Homebrew Tap | https://github.com/scoutos-labs/homebrew-hive |
| npm Package | https://www.npmjs.com/package/@scoutos-labs/hive |
| Install Script | https://raw.githubusercontent.com/scoutos-labs/hive/main/install.sh |
| Install Script (short) | https://get.hive.dev |