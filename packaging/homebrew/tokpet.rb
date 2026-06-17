class Tokpet < Formula
  desc "Desktop pet that surfaces real-time AI usage/quota/balance across providers"
  homepage "https://github.com/grpcer/tokpet"
  url "https://registry.npmjs.org/tokpet/-/tokpet-0.1.2.tgz"
  sha256 "6ac9d4592811e6db55b2a9b942377f56abfeb297f9cf1350e48191de26ae7ed4"
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
      Start the service:
        brew services start tokpet

      On first start it opens the setup page automatically. To reopen it later:
        tokpet open   # or visit http://localhost:4717
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tokpet --version")
  end
end
