# Pages browser integration probes

Run against the built frontend and real temporary rooms. Requires Python dependencies
`cryptography websockets playwright` and Playwright Chromium/WebKit binaries with
system dependencies. Use an isolated container for trial builds.

From the repository root:

```
python tests/browser/real_browser.py
python tests/browser/seal_browser.py
```

`real_browser.py` checks two viewers, human and agent edits, HTML replacement without
losing board history, transient load recovery, activity messages, and closing during
a pending fetch. Screenshots go to `$BROWSER_RESULTS` or
`/tmp/shellphone-browser-results`.

`seal_browser.py` uses a local HTTP tripwire and checks parent/storage access,
WebRTC (including a nested frame), network requests and frame navigation. These
are specific regression probes, not a proof against every possible browser escape.

The relay integration test uses the real local Wrangler relay and browser transport:

```
RELAY_E2E=1 python tests/test_pages_relay.py
```
