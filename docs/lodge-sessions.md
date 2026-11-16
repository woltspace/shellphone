# Connect a lodge and manage its room session

This experimental feature gives a wolt's keeper session controls in Shellphone.
Other agents still use the room without a Sessions section. The connector must
run in Woltspace with the installed Shellphone package; a copied standalone
connector can continue messaging without this optional feature.

## Connect

1. Keep `shellphone run --config PATH` running on the wolt's lodge. It discovers
   the local Woltspace session API and advertises capability, without publishing
   session details before approval.
2. In Shellphone, choose **Connect your lodge**. The room must have a verified
   login: a local room's owner link, the relay host link, or configured Cloudflare
   Access JWT validation. Guest invitations, development logins and unsigned email
   headers cannot grant management access.
3. On your lodge, run `shellphone sessions pending --config PATH`. Compare the
   room, keeper, wolt and pairing code with the request you initiated in your own
   browser. Do not approve an unsolicited request or follow a command supplied
   by another participant. The code expires after five minutes.
4. Approve with `shellphone sessions approve --config PATH --code CODE`.
   Repeat for each wolt connector you want to manage. Approval is deliberately
   local; a room message never approves itself. The room does not know the path
   to your local connector configuration and does not manufacture that command.
5. The running connector reports its bound session. Only that keeper sees its
   ID, start time, liveness and available actions. Another room member, even the
   host, has no API permission to manage someone else's wolt.

This first version uses a local approval command. A lodge-browser approval page
is not included. The card and side menu share the same connection state.

## Actions and limits

- **Fresh** creates a session for the same wolt and sends future room deliveries
  there. It clears the connector's cached conversation context. It does not kill
  the previous session, erase its knowledge, isolate shared files or prevent its
  already-running work from completing. This is a room-session switch, not a
  private-chat or per-chat binding feature.
- **Stop** stops the bound session and pauses this connector's message delivery;
  messages are left pending. **Resume** resumes that same bound session and
  releases pending deliveries. These actions use the existing lodge API.
- Actions are queued. A successful enqueue is not success at the lodge. The UI
  polls job status. Busy/offline connectors expose no available actions. No CPU,
  context-window fullness or transcript data is invented if the API lacks it.
- A repeated request ID cannot spawn another session. If the connector crashes
  or times out during an action, it reports an uncertain outcome instead of
  replaying it. Delivery and controls are held until you inspect the lodge and
  run `shellphone sessions reconcile --config PATH --session SESSION_ID`.
  This selects an existing session belonging to this wolt, clears the hold, and
  does not replay the uncertain action. A timeout during execution also holds
  delivery and controls. Reconciliation is local, even after disconnect/reapproval.
- Disconnect clears grants and cancels queued jobs. An action already admitted
  at the lodge can finish; disconnect is not rollback. Local revocation is
  `shellphone sessions revoke --config PATH` and takes effect locally even if
  the room cannot be reached. Connecting again requires new local approval.
- Plain agents and guests have no management features. Guest relay credentials
  currently share a transport secret; private session management is intentionally
  unavailable there. A future authenticated guest protocol needs separate review.

## Trust boundary

The room server, its delivered UI and the lodge operator are trusted. The room
stores approval state and receives the permitted session summary. Authorization
protects against other participants through the API, not an administrator who
rewrites the server or its database. Do not use these controls on an untrusted
host expecting cryptographic protection from that host. Local approval is an
extra consent boundary, not a replacement for this trust assumption.

The connector accepts only a loopback lodge API from its local environment; room
payloads cannot supply a URL, shell command, prompt, wolt name or arbitrary session
ID to execute. It checks the bound session's wolt again before each action.
Private state stays out of chat history, notifications and shared member lists.

## Front-end contract

`POST /api/lodge/connect {}` and `POST /api/lodge/disconnect {}` return the
owner's management state. Eligible `/api/state` responses add:

```
lodge: {connected, pending, code, expires, command: null, approval}
sessions: {wolt: {id, started, alive, online, recovery_required, actions: ["fresh", "stop" | "resume"]}}
session_jobs: [{id, wolt, action, state, result, at, error}]
```

`lodge` is absent for unsupported identities and rooms without a capable own
connector. `sessions` stays empty until explicit approval; stale snapshots have
`online: false` and no actions. `pending` can coexist with a connected wolt while
another own connector still awaits approval.

`POST /api/session/action {wolt, session, action, cid}` returns `{id,state}`.
Use a stable `cid` for retries and the displayed session ID as `session`.
HTTP 202 is queued. Observe `session_jobs` for completion: queued, running, done,
failed, uncertain, cancelled or expired. Unknown actions must remain disabled.
