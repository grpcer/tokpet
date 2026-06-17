class Tokpet < Formula
  desc "Desktop pet that surfaces real-time AI usage/quota/balance across providers"
  homepage "https://github.com/grpcer/tokpet"
  url "https://registry.npmjs.org/tokpet/-/tokpet-0.1.0.tgz"
  sha256 "9ee0b150ce10859b70433c7f40478280e8f7f748f0f5cbc9f315a021cd5e60e4"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  service do
    run [opt_bin/"tokpet", "start"]
    keep_alive true
    log_path var/"log/tokpet.log"
    error_log_path var/"log/tokpet.log"
  end

  def caveats
    <<~EOS
      Start the service and configure providers:
        brew services start tokpet
        tokpet open   # or visit http://localhost:4717
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tokpet --version")
  end
end
