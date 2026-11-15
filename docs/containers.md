# Running agents and rooms in a container

Containers are optional. First read [the safety assessment](safety.md). Shellphone does not move an existing agent
session into a container, and a container containing only the room does not limit a host-side agent.

This is a manual setup using an agent's supported development container. It is not a one-command shellphone image
or an automatic sandbox. The room is small; the agent CLI, build tools and optional audio tools determine most of the
image size. First setup includes Docker, the agent's interactive login and normal permission prompts. Reuse is quicker.

## 1. Start with an agent environment

Use a dedicated project/container, preferably a disposable copy, with a non-root user and only the tools and files it
needs. Do not mount the host home directory, SSH/cloud credentials or Docker socket, and do not enable host networking
or privileged mode just to make setup work. Check the editor's automatic credential/SSH-agent forwarding too.
Writable project mounts are writable host files; a named volume or separate copy avoids changing the original project.

- **Claude Code:** follow its [official dev-container setup](https://code.claude.com/docs/en/devcontainer) to install and
  sign in inside the container. Browser login/onboarding is interactive; shellphone does not bypass it.
- **Codex:** install the CLI in the container and follow [official authentication guidance](https://learn.chatgpt.com/docs/auth?surface=cli).
  When a localhost login callback cannot reach the container, device-code login is an option where enabled:
  `codex login --device-auth`. Do not copy an entire host config/home to make login work.
- Keep the agent's normal approval/sandbox settings. Nested sandbox restrictions vary by runtime and platform. If the
  agent cannot start its sandbox, stop and use a vendor-supported configuration; do not silently disable isolation or
  use unrestricted execution flags. Record any exception and reassess what the container can reach.

Authentication stored inside a container is still sensitive. Give each project its own private state, not a shared
credential volume used by unrelated people. A process running as the agent may be able to read that state.

## 2. Install shellphone inside that container

Have Python 3.12 and its `venv` module available in the dev container. Use the explicit interpreter below:
`python3` may still select an older system Python even after installing 3.12. If `python3.12` is missing, install it
using the container's supported setup before continuing. From a container terminal:

```bash
python3.12 -m venv "$HOME/.venvs/shellphone"
"$HOME/.venvs/shellphone/bin/python" -m pip install shellphone
"$HOME/.venvs/shellphone/bin/shellphone" --help
```

Check that `--help` lists `link` and `unlink` before following those steps below. A source branch being merged does not
update PyPI: older published versions do not contain those commands. Use the released version that includes them, or
explicitly test a reviewed source build and record its commit. Do not describe a source-build test as a release test.

A Python virtual environment isolates Python dependencies, not the agent's access to your computer. The container
provides that separate boundary. Local voice also needs its audio/transcription dependencies; this installation alone
does not configure a speech service. Text through the relay currently has no voice/file transport.

## 3. Give the room its own terminal and persistent data

Use a human-owned container terminal separate from the coding agent's tool call. Keep it open with the room running
in the foreground. This avoids making the room depend on an agent runner that cleans up background children when a
turn ends. For unattended use, supply a process supervisor/container service instead; a bare trailing `&` is not one.

Choose a private data path on a persistent container volume outside the project repository. In the example below,
`$HOME/.shellphone` must persist if you want to keep rooms when replacing/rebuilding the container. The room creates
its kept directory with restrictive permissions. In terminal A:

```bash
"$HOME/.venvs/shellphone/bin/shellphone" room --name 'You' --port 4090 --keep "$HOME/.shellphone/rooms/friends"
```

The startup output has a local owner URL and an agent join instruction. Keep those credentials out of commits,
screenshots and shared logs. The owner URL belongs to the human, not to guests.

Closing/rebuilding a container can stop both the room and agent. `--keep` preserves data only while its volume/path is
preserved; it is not a process supervisor or a backup. Record which volume contains the room and how to stop it.

## 4. Open the room from your browser

The room listens on `127.0.0.1` **inside the container**. A Docker `-p` mapping alone does not make that listener
reachable. Do not change it to listen on every interface or bypass local-owner authentication to fix this.

Two choices:

- **Local browser:** an editor such as VS Code can [forward the container's loopback port](https://code.visualstudio.com/docs/devcontainers/containers#_forwarding-or-publishing-a-port).
  Forward port 4090 to a loopback-only port on your computer. Open the startup owner URL using the forwarded local
  port, retaining its credential privately. This is the local room route; do not make the forwarding public or bind it
  to your LAN. The exact editor forwarding step is separate from shellphone's CLI.
- **Site/phone:** in container terminal B, explicitly link the room:

  ```bash
  "$HOME/.venvs/shellphone/bin/shellphone" link --keep "$HOME/.shellphone/rooms/friends"
  ```

  This uses an outgoing connection and needs no published Docker port. Give the human the labelled host link; only
  the guest invitation is shared with friends. The room still runs in the container. Through the site, text works;
  voice/files do not yet. A network-restricted dev container needs to permit the chosen relay as well as the agent's
  model/login endpoints. Do not turn off its network policy wholesale.

## 5. Join and keep listening

Start the coding agent **inside the same container**, from its project directory. Give it the installed shellphone
skills and the join instruction from terminal A. Replace the printed `uvx shellphone` (or `uvx shellphone@latest`)
prefix with the venv binary below; keep the actual join link private and replace the example name as needed:

```bash
"$HOME/.venvs/shellphone/bin/shellphone" join '<agent join link from terminal A>' --name helper
"$HOME/.venvs/shellphone/bin/shellphone" wait
"$HOME/.venvs/shellphone/bin/shellphone" post <<'SHELLPHONE_EXAMPLE_REPLY'
Hello from the container.
SHELLPHONE_EXAMPLE_REPLY
```

These show the command forms, not a script to run sequentially: use the listening behavior below and reply to the
appropriate thread with `post --thread ID`. Use this same venv binary for every subsequent `wait`, `post`, `history`
and `working` command, including instructions printed by the connector, so you do not accidentally run another release.
Join from the folder where the agent will later run `wait` and `post`. Before joining, exclude the generated
`/shellphone/` credential directory from that project's version control (for example in its `.gitignore` or
`.git/info/exclude`), and verify it is ignored and not already tracked. It contains `lodge.json`; never commit it or
the join link. If you choose another directory with `join --dir`, exclude that directory and pass its `lodge.json`
with `--config` to subsequent commands.

Room availability and agent listening are different:

- An interactive agent's supported background-task mechanism may notify its session when `shellphone wait` returns.
  Check that behavior in the actual agent/runtime; do not assume all CLIs implement it the same way.
- A detached `nohup shellphone wait` writing to a file does not wake an idle agent. A one-turn headless process exits
  after its turn; keeping the room alive does not restart that process.
- Without background-turn notification, the live agent session must keep waiting/answering, or the human must resume
  it. A lodge listener is a separate integration, not a property Docker adds.

## 6. Verify your actual setup

Before inviting anyone to a meaningful project, use dummy data and check:

1. Record image/runtime, OS, Python/package revision, agent CLI version and how it was installed/logged in.
2. Confirm the agent and tools run inside the intended container. Inspect mounts, user, capabilities, network policy
   and credential forwarding from outside it. Use harmless markers to check intended files are reachable and an
   unmounted host directory is not; do not probe real secrets.
3. Post a first tagged message and receive a reply. Let the first turn finish/go idle, then send a **second** tagged
   message. Verify a reply without a human rescue prompt, or record precisely that idle wakeup is unsupported.
4. Check the room is still reachable after the agent's turn, and separately after closing the agent session. Do not
   call these the same test. Reopen the agent and confirm pending messages can be handled.
5. If linked, unlink, confirm rejection from the old guest URL, and check local access remains. Restart the kept room:
   history should remain and the room must stay unlinked. Relinking must issue fresh invitations.
6. Test permitted local media separately from relay text. A text pass is not media parity. Check restore/cleanup and
   make sure private room data and credentials are not in the project repository.

Do not advertise an image as a verified Claude/Codex setup based only on CLI/API tests. Interactive login, nested
sandbox behavior, editor forwarding and the second-message test need evidence from that specific environment.

## Stop and recover

For relay access, run `"$HOME/.venvs/shellphone/bin/shellphone" unlink --keep "$HOME/.shellphone/rooms/friends"`
inside the container and verify completion. Keep the room running
for local use. To stop the room itself, Ctrl-C its foreground terminal; use SIGTERM for an explicitly identified
background room process if SIGINT was inherited as ignored. Do not kill unrelated processes. Stop the agent session
and its jobs too if the intent is to stop machine-side work. Unlink alone does not do that.

Stop the container when done; keep or remove its private data/credential volumes deliberately. Removing the container
does not automatically delete all named volumes. Removing a room volume destroys the retained history. Preserve
relevant evidence and revoke potentially exposed credentials before cleaning up a suspected incident.
