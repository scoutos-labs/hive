#!/bin/bash
#
# Hive Installation Script
# https://github.com/scoutos-labs/hive
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/scoutos-labs/hive/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/scoutos-labs/hive/main/install.sh | bash -s -- v0.1.0
#   INSTALL_DIR=$HOME/.local/bin curl -fsSL https://raw.githubusercontent.com/scoutos-labs/hive/main/install.sh | bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
VERSION="${1:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="hive"
REPO="scoutos-labs/hive"

# Print functions
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Detect OS and architecture
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    
    case "$OS" in
        Darwin) OS="darwin" ;;
        Linux)  OS="linux" ;;
        MINGW*|MSYS*|CYGWIN*)
            warn "Detected Windows via MSYS/Cygwin"
            OS="windows"
            ;;
        *)
            error "Unsupported OS: $OS"
            ;;
    esac
    
    case "$ARCH" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *)
            error "Unsupported architecture: $ARCH"
            ;;
    esac
    
    BINARY="hive-${OS}-${ARCH}"
    if [ "$OS" = "windows" ]; then
        BINARY="${BINARY}.exe"
        BINARY_NAME="hive.exe"
    fi
    
    info "Detected platform: ${OS}-${ARCH}"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Download binary
download_binary() {
    info "Downloading Hive ${VERSION}..."
    
    if [ "$VERSION" = "latest" ]; then
        URL="https://github.com/${REPO}/releases/latest/download/${BINARY}.tar.gz"
    else
        # Strip 'v' prefix if present
        VERSION_CLEAN="${VERSION#v}"
        URL="https://github.com/${REPO}/releases/download/v${VERSION_CLEAN}/${BINARY}.tar.gz"
    fi
    
    TMP_DIR=$(mktemp -d)
    TAR_FILE="${TMP_DIR}/${BINARY}.tar.gz"
    
    # Download
    if command_exists curl; then
        curl -fsSL "$URL" -o "$TAR_FILE" || {
            error "Failed to download binary from $URL"
        }
    elif command_exists wget; then
        wget -q "$URL" -O "$TAR_FILE" || {
            error "Failed to download binary from $URL"
        }
    else
        error "Either curl or wget is required"
    fi
    
    # Extract
    tar -xzf "$TAR_FILE" -C "$TMP_DIR" || {
        error "Failed to extract archive"
    }
    
    BINARY_PATH="${TMP_DIR}/${BINARY}"
    
    if [ ! -f "$BINARY_PATH" ]; then
        error "Binary not found after extraction"
    fi
    
    success "Downloaded ${BINARY}.tar.gz"
}

# Install binary
install_binary() {
    info "Installing Hive to ${INSTALL_DIR}..."
    
    # Create directory if it doesn't exist
    if [ ! -d "$INSTALL_DIR" ]; then
        mkdir -p "$INSTALL_DIR" 2>/dev/null || {
            warn "Cannot create ${INSTALL_DIR}, will try with sudo"
            NEED_SUDO=1
        }
    fi
    
    # Check if we need sudo
    NEED_SUDO=0
    if [ ! -w "$INSTALL_DIR" ]; then
        NEED_SUDO=1
    fi
    
    # Move binary
    if [ "$NEED_SUDO" = "1" ]; then
        warn "Requires sudo to install to ${INSTALL_DIR}"
        sudo mv "$BINARY_PATH" "${INSTALL_DIR}/${BINARY_NAME}"
        sudo chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    else
        mv "$BINARY_PATH" "${INSTALL_DIR}/${BINARY_NAME}"
        chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    fi
    
    success "Installed hive to ${INSTALL_DIR}/${BINARY_NAME}"
}

# Verify installation
verify_installation() {
    info "Verifying installation..."
    
    if [ ! -x "${INSTALL_DIR}/${BINARY_NAME}" ]; then
        error "Binary is not executable"
    fi
    
    success "Installation verified"
    
    # Try to show version
    if "${INSTALL_DIR}/${BINARY_NAME}" --version 2>/dev/null; then
        :
    else
        warn "Could not get version (binary may need additional setup)"
    fi
}

# Post-install message
post_install() {
    echo ""
    echo -e "${GREEN}══════════════════════════════════════${NC}"
    echo -e "${GREEN}  Hive installed successfully!        ${NC}"
    echo -e "${GREEN}══════════════════════════════════════${NC}"
    echo ""
    
    # Check if in PATH
    if ! command_exists hive; then
        warn "hive is not in your PATH"
        echo ""
        echo "Add the following to your shell profile:"
        echo ""
        echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
        echo ""
        echo "Then restart your shell or run:"
        echo ""
        echo "  source ~/.bashrc  # or ~/.zshrc"
        echo ""
    fi
    
    echo "Run 'hive' to start the server."
    echo ""
    echo "Documentation: https://github.com/scoutos-labs/hive"
    echo ""
}

# Cleanup
cleanup() {
    rm -rf "$TMP_DIR"
}

# Check for existing installation
check_existing() {
    if command_exists hive; then
        EXISTING=$(which hive)
        info "Found existing installation at ${EXISTING}"
    fi
    
    if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
        warn "Replacing existing installation at ${INSTALL_DIR}/${BINARY_NAME}"
    fi
}

# Uninstall function
uninstall() {
    info "Uninstalling Hive..."
    
    if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
        rm -f "${INSTALL_DIR}/${BINARY_NAME}" || sudo rm -f "${INSTALL_DIR}/${BINARY_NAME}"
        success "Removed ${INSTALL_DIR}/${BINARY_NAME}"
    else
        warn "Hive is not installed in ${INSTALL_DIR}"
    fi
}

# Main
main() {
    echo -e "${BLUE}"
    echo "  ╔═════════════════════════════════╗"
    echo "  ║      Hive Installer             ║"
    echo "  ║  Agent Communication Platform   ║"
    echo "  ╚═════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    
    # Handle --uninstall flag
    if [ "$1" = "--uninstall" ]; then
        uninstall
        exit 0
    fi
    
    # Detect platform
    detect_platform
    
    # Check existing
    check_existing
    
    # Download
    download_binary
    
    # Install
    install_binary
    
    # Verify
    verify_installation
    
    # Cleanup
    cleanup
    
    # Post-install message
    post_install
}

# Run main
main "$@"