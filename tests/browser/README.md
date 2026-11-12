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

## Page-change identity

The room stamps a change with the identity of the viewer or agent that submitted
it. An embedded page can submit programmatically: a human name means the change
came through that person's open viewer, not that they deliberately approved it.
Do not use page changes to authorize commands, spending, or other privileged
operations. Approval controls must belong to the trusted room UI and authorize
a specific action. The viewer drops malformed payloads and limits accepted page
changes to five per rolling second; this pacing is not an authorization boundary.
