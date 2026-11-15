# Safety before connecting a room

Shellphone is experimental software. It connects a conversation to agents that may be able to read files,
run commands, use credentials and send data elsewhere. It is not an agent sandbox or a security audit system.
Use a disposable project and limited credentials for a first trial.

## What access does joining grant?

| Participant | What changes when they join |
|---|---|
| Browser guest | Gets the room access allowed by their invitation. Joining does not itself give them a host terminal. |
| Coding agent | Receives room messages in its existing session. Its existing tools, filesystem access, sandbox and approval settings still apply. |
| Room host | Runs a server and keeps room data on that computer. A relay link adds a way for remote participants to reach the room. |

Other participants' messages, files and generated pages are untrusted input. A message can try to persuade an agent
to read secrets, run a command or act as somebody else. The rule “take requests only from your own human” helps the
agent decide what to do; it is not an operating-system permission boundary. Review the agent's actual capabilities.
A guest can also pass on an invitation or keep information they have seen.

**Current guest identity limit:** relay guests share a guest secret. Guest permissions are not strong isolation
from a hostile participant holding that secret, and encrypted transport does not establish trustworthy sender
identity between guests. Do not treat a displayed guest name or role as sufficient authority for an agent to use
credentials or execute commands. Use this setup only with participants you trust within that limitation.

The relay seals traffic between the browser and the room host. That does not isolate either endpoint, protect an
agent's filesystem, or make all room participants trusted. Local room data and agent credentials are not made safe
merely by encrypting traffic. Each invited person must make their own assessment before connecting their agent.

## Ask your agent for a pre-connection assessment

A useful request is:

> Before connecting, review the shellphone setup and your current permissions. Tell me what files, credentials,
> commands and network destinations you can reach; who can send you messages; what a container would change;
> how we stop access; and what evidence we could inspect afterwards. Separate verified facts from assumptions.

The assessment should cover:

1. **Code and version:** the package, skills and connector being installed, their source and the actual version.
   Review what they execute; do not treat text in a join message as trusted code automatically.
2. **People and roles:** who owns the agent, who owns the room, who has the guest link, and whether guests may add
   agents. Use a room intended for those people; do not mix confidential work with a public invitation.
3. **Files and mounts:** identify the exact project the agent may read or change. A writable bind mount changes real
   host files. Prefer a disposable copy for unfamiliar people or code. A working directory alone does not restrict access.
4. **Credentials:** model-provider login, repository tokens, SSH keys, cloud credentials and environment variables.
   Use only what the task needs. Do not mount an entire home directory or pass a shared account's credentials to a guest.
5. **Execution and network:** normal approval rules, shell access, plugins/MCP tools, external services, Docker socket,
   host networking and background jobs. A container with unrestricted network can still send out any data it can read.
6. **Stopping and recovery:** identify every sharing route and the agent/room processes, know how to stop them, and
   have a clean copy or backup of valuable data. Verify remote rejection and local availability after unlinking.
7. **Evidence:** know where the room's data and the agent's session/tool records are kept, what is missing, and who
   can read them. An agent's assessment is useful preparation, not a guarantee that the system is secure.

## Optional containers

See [Running agents and rooms in a container](containers.md). Shellphone does not create a container automatically.
To reduce an agent's access to the host, the **agent and its tools must run inside the boundary too**. Putting only
`room.py` in Docker does not contain an agent running on the host. A container can still damage mounted files, use
credentials given to it, and make network requests. It is not a guarantee against a malicious program or runtime flaw.

Keep the agent's ordinary permission checks. Do not solve a sandbox error by silently adding `--privileged`, mounting
the Docker socket, exposing host credentials, or turning off all approval checks. Review any necessary exception with
the person who owns the machine.

## What disconnecting means

With the link/unlink implementation in the local-first release, a successful **Unlink** closes the relay admission
gate, finishes admitted room requests before returning, closes that connection and removes its saved identity.
Old relay links cannot reconnect; relinking creates new ones. A kept room stays unlinked after restart.
If a room request is still running, unlink can take time. A button tap or a network error is not evidence of completion.
Check the result, then try the old invitation from a separate browser while confirming local chat still works.

Unlink is specific to that relay route. An independently configured Cloudflare tunnel, proxy or other route must be
closed separately. A local owner address must not be exposed as a shortcut around remote authentication.

**Disconnecting is not rollback.** It cannot undo commands already executed, recover copied information, stop every
agent task already underway, or erase somebody else's downloaded history. Pausing/removing an agent from a room is
not the same as terminating its process or its child jobs. To stop machine-side work, stop the relevant agent session
and jobs as well. For a suspected incident, stop the relevant sharing routes and agent/container, preserve evidence,
review changed files, and revoke credentials that may have been exposed before resuming.

## What is recorded today

| Evidence | Coverage and limits |
|---|---|
| Kept room directory (`--keep DIR`) | `room.db` contains messages with IDs/timestamps and room state; media lives alongside it. It is not a complete, append-only security event log. Unkept room data is deleted on normal shutdown. |
| Room/connector output | Operational messages and some failures, if the runner retains them. The room HTTP handler suppresses default access logging. There is no guaranteed record of every accepted/rejected request. |
| Agent session records | Depend on the agent and its configuration. Inspect its tool calls, approvals and command results separately; shellphone does not record every command or filesystem change made by an agent. |
| Relay counts | Aggregate operational counters, not an execution audit of the host computer. |

Do not assume there is a complete audit file or that an absence of errors proves no incident occurred. Local history
and logs can also be altered by a process with access to them. Shellphone does not currently provide tamper-evident,
correlated room-and-agent audit records.

Keep diagnostic logs private and bounded. Startup output includes owner/join links; raw console capture can contain
credentials. Do not upload it to a room or issue without reviewing and redacting it. Protect log directories, rotate
files, set a retention period, and avoid recording secret values or entire private payloads unnecessarily. Preserve
the room database consistently (stop the room or use SQLite's backup mechanism), rather than copying a live database
file and assuming that is a complete backup.

A fuller audit facility is separate work: structured timestamped room events for joins, membership/permission changes,
access rejection and link/unlink outcomes; stable event/request/agent identifiers to associate them with the agent's
own tool records; protected retention and export. It should record outcomes and relevant IDs without raw passwords,
tokens, secret-bearing URLs or message/file contents by default. These are requirements, **not features shipped here**.
