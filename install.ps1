# Hive Installation Script for Windows
# https://github.com/scoutos-labs/hive
#
# Usage:
#   irm https://raw.githubusercontent.com/scoutos-labs/hive/main/install.ps1 | iex
#   $VERSION="v0.1.0"; irm https://raw.githubusercontent.com/scoutos-labs/hive/main/install.ps1 | iex

param(
    [string]$Version = "latest",
    [string]$InstallDir = "",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Configuration
$Repo = "scoutos-labs/hive"
$BinaryName = "hive-windows-x64.exe"

# Colors
function Write-Info($Message) { Write-Host "ℹ $Message" -ForegroundColor Cyan }
function Write-Success($Message) { Write-Host "✓ $Message" -ForegroundColor Green }
function Write-Warning($Message) { Write-Host "! $Message" -ForegroundColor Yellow }
function Write-Error($Message) { Write-Host "✗ $Message" -ForegroundColor Red; exit 1 }

# Detect architecture
function Get-Platform {
    $Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    
    if ($Arch -eq "X64") {
        return "x64"
    } elseif ($Arch -eq "Arm64") {
        return "arm64"
    } else {
        Write-Error "Unsupported architecture: $Arch"
    }
}

# Determine install directory
function Get-InstallDir {
    if ($InstallDir -ne "") {
        return $InstallDir
    }
    
    # Try user scope first
    $UserBin = "$env:LOCALAPPDATA\hive\bin"
    $SystemBin = "$env:ProgramFiles\hive"
    
    if (Test-Path $UserBin) {
        return $UserBin
    }
    
    # Default to user scope
    return $UserBin
}

# Download binary
function Install-Hive {
    $Arch = Get-Platform
    $Binary = "hive-windows-$Arch.exe"
    $InstallDir = Get-InstallDir
    $BinaryPath = Join-Path $InstallDir "hive.exe"
    
    # Determine URL
    if ($Version -eq "latest") {
        $Url = "https://github.com/$Repo/releases/latest/download/$Binary.zip"
    } else {
        $VersionClean = $Version -replace '^v', ''
        $Url = "https://github.com/$Repo/releases/download/v$VersionClean/$Binary.zip"
    }
    
    Write-Info "Downloading Hive $Version for Windows-$Arch..."
    
    # Create temp directory
    $TempDir = New-TemporaryDirectory
    
    # Download
    $ZipFile = Join-Path $TempDir "$Binary.zip"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $ZipFile -UseBasicParsing
    } catch {
        Write-Error "Failed to download from $Url"
    }
    
    # Extract
    Write-Info "Extracting..."
    Expand-Archive -Path $ZipFile -DestinationPath $TempDir -Force
    
    # Create install directory
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    
    # Move binary
    $ExtractedBinary = Join-Path $TempDir $Binary
    if (-not (Test-Path $ExtractedBinary)) {
        # Try without .exe extension
        $ExtractedBinary = Join-Path $TempDir "hive-windows-$Arch"
    }
    
    Move-Item -Path $ExtractedBinary -Destination $BinaryPath -Force
    
    # Cleanup
    Remove-Item -Path $TempDir -Recurse -Force
    
    Write-Success "Installed Hive to $BinaryPath"
    
    # Add to PATH
    $PathEnv = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($PathEnv -notlike "*$InstallDir*") {
        Write-Info "Adding $InstallDir to PATH..."
        [Environment]::SetEnvironmentVariable("PATH", "$PathEnv;$InstallDir", "User")
        Write-Success "Added to PATH"
    }
    
    return $BinaryPath
}

# Create temporary directory
function New-TemporaryDirectory {
    $TempPath = [System.IO.Path]::GetTempPath()
    $TempDir = [System.IO.Path]::Combine($TempPath, [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $TempDir | Out-Null
    return $TempDir
}

# Uninstall
function Uninstall-Hive {
    $InstallDir = Get-InstallDir
    $BinaryPath = Join-Path $InstallDir "hive.exe"
    
    if (Test-Path $BinaryPath) {
        Remove-Item -Path $BinaryPath -Force
        Write-Success "Removed $BinaryPath"
        
        # Remove from PATH
        $PathEnv = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($PathEnv -like "*$InstallDir*") {
            $NewPath = ($PathEnv -split ';' | Where-Object { $_ -ne $InstallDir }) -join ';'
            [Environment]::SetEnvironmentVariable("PATH", $NewPath, "User")
            Write-Success "Removed from PATH"
        }
    } else {
        Write-Warning "Hive is not installed in $InstallDir"
    }
}

# Main
Write-Host ""
Write-Host "  ╔═════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║      Hive Installer             ║" -ForegroundColor Cyan
Write-Host "  ║  Agent Communication Platform   ║" -ForegroundColor Cyan
Write-Host "  ╚═════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if ($Uninstall) {
    Uninstall-Hive
    exit 0
}

# Check for existing installation
$ExistingHive = Get-Command hive -ErrorAction SilentlyContinue
if ($ExistingHive) {
    Write-Warning "Found existing installation at $($ExistingHive.Source)"
}

# Install
$BinaryPath = Install-Hive

# Verify
Write-Info "Verifying installation..."
& $BinaryPath --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Success "Installation verified"
}

# Done
Write-Host ""
Write-Host "══════════════════════════════════════" -ForegroundColor Green
Write-Host "  Hive installed successfully!        " -ForegroundColor Green
Write-Host "══════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Run 'hive' to start the server."
Write-Host ""
Write-Host "Documentation: https://github.com/scoutos-labs/hive"
Write-Host ""