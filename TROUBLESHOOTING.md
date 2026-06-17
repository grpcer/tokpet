# Troubleshooting

Common issues when connecting a Tokpet device to the companion.

## The console works, but my device still says "open the console to add a provider"

The **browser console** and the **hardware device** are two independent clients of the
companion. Opening `http://localhost:4717` in your browser only proves the companion is
running on this computer and your provider is configured — it says nothing about whether the
device can reach it.

A device shows that onboarding message until it can poll the companion's `GET /state` and
receive provider data. If the console's **Devices** card stays on **Waiting / no devices
yet**, the companion has never received a `/state` request from your device.

The companion only lists a device after a `/state` request arrives from **another machine on
your network**. Requests from this same computer — including the browser console at
`localhost` — are intentionally ignored, so the console itself never appears under Devices.
"Devices: Waiting" therefore means no device on your LAN has reached the companion yet. Work
through the checklist below.

### Checklist

1. **Same network.** The device and the computer running the companion must be on the **same
   Wi-Fi / LAN (same subnet)**. A guest network, a second router, or a phone hotspot that only
   one of them joined will all break this.

2. **Prove the network path.** From a **phone on the same Wi-Fi as the computer**, open:

   ```
   http://<computer-LAN-IP>:4717/state
   ```

   - You see JSON → the network path is fine; the problem is on the device side (it joined the
     wrong network, or hasn't been set up — see
     [Moving your device to a new Wi-Fi](#moving-your-device-to-a-new-wi-fi)).
   - The page does not load → your network blocks device-to-device traffic (**AP / client
     isolation**, a guest VLAN, or a VPN on the computer). Disable isolation on the router, or
     put both the device and the computer on a network you control (a personal hotspot or a
     travel router).

   You can find the computer's LAN address and the exact `/state` URLs in the console under
   **Network → Tokpet device discovery**.

3. **Firewall.** Allow inbound connections to the companion's port (`4717` by default) on the
   computer.

4. **mDNS.** The device discovers the companion automatically via the `_tokpet._tcp.local`
   service. VPNs and client isolation also break mDNS, so the checks above cover it too.

## Moving your device to a new Wi-Fi

A Tokpet device remembers **one** Wi-Fi network. When you move it somewhere new (home →
office), it keeps trying to rejoin the old network and will **not** open its setup hotspot on
its own — so it never reaches the companion on the new network. Re-run setup to hand it the
new credentials:

1. **Clear the saved Wi-Fi.** Press and hold the device button until it reboots into setup. On
   the round-screen StopWatch board this is the **A** button, held about one second. The device
   erases its saved Wi-Fi and restarts.

2. **Join the device's setup hotspot.** After it restarts with no saved network, the device
   broadcasts its own open Wi-Fi named **`Tokpet-XXXX`** (the suffix is unique to your device).
   Connect your phone to it.

3. **Enter the new network.** A captive portal opens automatically (if it doesn't, browse to
   `http://192.168.4.1`). Pick the new Wi-Fi and enter its password.

4. **Done.** After the page reports **Connected!**, the device rejoins the network, discovers
   the companion via mDNS, and appears under **Devices** in the console within seconds.

> Clearing the saved Wi-Fi also forgets the previous network — you'll run setup again when you
> move back. This is expected; the device stores a single set of credentials.
