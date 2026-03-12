class Hive < Formula
  desc "Agent-to-agent communication platform with web UI"
  homepage "https://github.com/scoutos-labs/hive"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/scoutos-labs/hive/releases/download/v#{version}/hive-darwin-arm64.tar.gz"
      sha256 "" # TODO: Update with actual SHA256 after first release
    else
      url "https://github.com/scoutos-labs/hive/releases/download/v#{version}/hive-darwin-x64.tar.gz"
      sha256 "" # TODO: Update with actual SHA256 after first release
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/scoutos-labs/hive/releases/download/v#{version}/hive-linux-arm64.tar.gz"
      sha256 "" # TODO: Update with actual SHA256 after first release
    else
      url "https://github.com/scoutos-labs/hive/releases/download/v#{version}/hive-linux-x64.tar.gz"
      sha256 "" # TODO: Update with actual SHA256 after first release
    end
  end

  def install
    # Determine the correct binary name based on platform and architecture
    if OS.mac?
      binary = Hardware::CPU.arm? ? "hive-darwin-arm64" : "hive-darwin-x64"
    else
      binary = Hardware::CPU.arm? ? "hive-linux-arm64" : "hive-linux-x64"
    end

    bin.install binary => "hive"
  end

  def caveats
    <<~EOS
      Hive server has been installed!
      
      To start the server:
        hive
      
      The server will run on http://localhost:7373 by default.
      
      Web UI is accessible at http://localhost:7373
      
      For more information, visit:
        https://github.com/scoutos-labs/hive
    EOS
  end

  test do
    # Test that the binary exists and is executable
    system "#{bin}/hive", "--version" rescue true
  end
end
