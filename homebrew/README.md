# Homebrew Formula for Hive

This directory contains the Homebrew formula for Hive.

## Setting up the Homebrew Tap

To make Hive installable via Homebrew, you'll need to create a separate tap repository:

1. Create a new repository named `homebrew-hive` at `https://github.com/scoutos-labs/homebrew-hive`

2. Copy `hive.rb` to the root of that repository

3. After creating a release, update the SHA256 hashes in `hive.rb`:

```bash
# Download each release artifact and calculate SHA256
curl -L https://github.com/scoutos-labs/hive/releases/download/v0.1.0/hive-darwin-arm64.tar.gz | shasum -a 256
curl -L https://github.com/scoutos-labs/hive/releases/download/v0.1.0/hive-darwin-x64.tar.gz | shasum -a 256
curl -L https://github.com/scoutos-labs/hive/releases/download/v0.1.0/hive-linux-x64.tar.gz | shasum -a 256
curl -L https://github.com/scoutos-labs/hive/releases/download/v0.1.0/hive-linux-arm64.tar.gz | shasum -a 256
```

4. Update the `hive.rb` file with the correct SHA256 hashes and version number

5. Commit and push to the tap repository

## Installation

Once the tap is set up, users can install Hive with:

```bash
brew tap scoutos-labs/hive
brew install hive
```

Or directly:

```bash
brew install scoutos-labs/hive/hive
```

## Updating the Formula

When releasing a new version:

1. Update the `version` field in `hive.rb`
2. Update all the SHA256 hashes for the new release artifacts
3. Commit and push to the tap repository
4. Users can update with `brew upgrade hive`
