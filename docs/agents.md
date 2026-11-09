# Agent access & computer use

emuman exposes two agent-facing surfaces:

1. **MCP (recommended)** — a Streamable HTTP MCP server at `/mcp` with 22 tools.
2. **REST** — a plain JSON API at `/api/agent` for custom agents and automation.

Both use the same **scoped bearer tokens**, created under **Agents** in the UI. Tokens are stored
only as SHA-256 hashes and can be revoked at any time.

![Agents page](screenshots/agents.png)

## Tokens and scopes

Create a token in **Agents → Create a token**, pick the capabilities, and copy the value — it is
shown once.

| Scope | Allows |
| --- | --- |
| `read` | list/inspect VMs, ISO library, logs, snapshots, host events/tasks |
| `control` | start, stop, reboot, pause/resume, create/delete/clone VMs, snapshot management |
| `console` | screenshots, display info, mouse/keyboard input, serial read/write |
| `exec` | run commands inside a guest over SSH |

Authenticate every request:

```http
Authorization: Bearer emuman_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The alternative `X-Emuman-Token` header is also accepted. Tokens are **bearer secrets**: use HTTPS
(or a private tunnel) whenever the agent runs on another machine.

Actions performed through a token are audited with the token name (`agent:claude-desktop`).

## MCP

```text
POST /mcp
Authorization: Bearer <token>
Content-Type: application/json
```

The server is stateless, supports JSON and SSE responses, ignores session IDs and advertises
protocol versions `2024-11-05`, `2025-03-26` and `2025-06-18`.

### Claude Code / MCP clients

```bash
claude mcp add --transport http emuman \
  http://<emuman-host>:8787/mcp \
  --header "Authorization: Bearer $EMUMAN_TOKEN"
```

Generic configuration:

```json
{
  "mcpServers": {
    "emuman": {
      "type": "http",
      "url": "http://<emuman-host>:8787/mcp",
      "headers": { "Authorization": "Bearer emuman_..." }
    }
  }
}
```

### Tool catalogue

Tools unavailable to the token's scopes are omitted from `tools/list` and return an explanatory
error if called.

| Tool | Scope | Purpose |
| --- | --- | --- |
| `emuman_list_vms` | read | machines, status, CPU/RAM, ports |
| `emuman_get_vm` | read | full config, disks, runtime |
| `emuman_list_isos` | read | ISO library with absolute paths |
| `emuman_list_snapshots` | read | snapshots for a VM |
| `emuman_vm_logs` | read | QEMU or serial log tail |
| `emuman_vm_action` | control | start, shutdown, stop, reboot, pause, resume |
| `emuman_create_vm` | control | create a guest, optionally attach ISO + start |
| `emuman_delete_vm` | control | delete VM + disks |
| `emuman_clone_vm` | control | clone a stopped VM |
| `emuman_create_snapshot` | control | snapshot disk + VM state |
| `emuman_restore_snapshot` | control | boot a saved snapshot |
| `emuman_screenshot` | console | PNG image + width/height |
| `emuman_screen_info` | console | current framebuffer resolution |
| `emuman_move_mouse` | console | absolute pointer move |
| `emuman_click` | console | click / double-click at pixel coordinates |
| `emuman_drag` | console | drag between two points |
| `emuman_scroll` | console | wheel up/down/left/right |
| `emuman_type_text` | console | type ASCII text |
| `emuman_press_keys` | console | key combos such as `ctrl+alt+del` |
| `emuman_serial_read` | console | buffered ttyS0 output |
| `emuman_serial_send` | console | write to ttyS0 (CR terminated) |
| `emuman_exec` | exec | SSH command execution |

### Computer-use loop

1. `emuman_screenshot` → PNG + `{ width, height }`.
2. Reason over the image; coordinates are **pixels** in that screenshot.
3. Call `emuman_click` / `emuman_move_mouse` / `emuman_type_text` / `emuman_press_keys`.
4. Screenshot again to verify.

The guest sees an absolute USB tablet, so pointer coordinates map directly to the framebuffer.
Typing is US-layout ASCII; non-ASCII characters are skipped. Use `emuman_exec` or the serial
console when you need to send arbitrary Unicode or large scripts.

Example (REST):

```bash
TOKEN=emuman_...
BASE=http://127.0.0.1:8787/api/agent
VM=<vm-id>

# Capture the screen
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/vms/$VM/screenshot" -o screen.png

# Click at (640, 400), type "root" and press Enter
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"click","x":640,"y":400}' "$BASE/vms/$VM/input"

curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"type","text":"root\n"}' "$BASE/vms/$VM/input"
```

Input payloads:

```json
{ "type": "move",   "x": 640, "y": 400 }
{ "type": "click",  "x": 640, "y": 400, "button": "left", "clicks": 2 }
{ "type": "drag",   "from_x": 100, "from_y": 100, "to_x": 400, "to_y": 300 }
{ "type": "scroll", "dy": 3, "x": 640, "y": 400 }
{ "type": "type",   "text": "uname -a\n", "interval_ms": 20 }
{ "type": "key",    "keys": "ctrl+alt+del" }
```

`keys` supports `ctrl`, `alt`, `shift`, `meta`/`super`, `enter`, `tab`, `esc`, `backspace`,
`delete`, arrows, `home`, `end`, `pgup`, `pgdn`, `f1`–`f12` and single characters.

### Serial

```text
GET  /api/agent/vms/:id/serial?limit=65536
POST /api/agent/vms/:id/serial   {"text":"root","append_newline":true}
```

`append_newline` defaults to `true` and appends a carriage return, which is what serial gettys and
shells expect. The serial chardev accepts one attached client at a time — detach the browser serial
tab if writes fail.

### Guest exec

```text
POST /api/agent/vms/:id/exec
{
  "command": "systemctl is-active nginx",
  "username": "root",          // optional, defaults to the VM SSH user
  "password": "…",             // optional, falls back to the encrypted saved password
  "host": "127.0.0.1",         // optional, defaults to the VM's SSH forward
  "port": 2200,
  "timeout_ms": 30000
}
```

Returns `{ stdout, stderr, code, signal, truncated, target }`. Output is capped at 256 KiB and
commands time out after at most 120 s. Host keys are pinned on first use; resolve mismatches under
**Settings → Known SSH hosts**.

## REST API

All endpoints require the bearer token. CORS is enabled for agent routes, so browser-based agents
can call them directly.

| Method & path | Scope | Description |
| --- | --- | --- |
| `GET /api/agent` | any | service info, token scopes, endpoint map |
| `GET /api/agent/vms` | read | list VMs |
| `POST /api/agent/vms` | control | create a VM |
| `GET /api/agent/vms/:id` | read | full VM detail |
| `DELETE /api/agent/vms/:id` | control | delete a VM |
| `POST /api/agent/vms/:id/action` | control | `{action, wait_ms}` |
| `POST /api/agent/vms/:id/clone` | control | `{name}` |
| `GET /api/agent/vms/:id/screenshot` | console | PNG + `X-Display-Width/Height` |
| `GET /api/agent/vms/:id/screen` | console | JSON with base64 PNG + dimensions |
| `GET /api/agent/vms/:id/display` | console | resolution only |
| `POST /api/agent/vms/:id/input` | console | computer-use input |
| `GET/POST /api/agent/vms/:id/serial` | console | serial read/write |
| `POST /api/agent/vms/:id/exec` | exec | SSH command |
| `GET /api/agent/vms/:id/logs` | read | QEMU/serial log |
| `GET/POST /api/agent/vms/:id/snapshots` | read/control | list/create |
| `POST /api/agent/vms/:id/snapshots/:name/restore` | control | restore |
| `DELETE /api/agent/vms/:id/snapshots/:name` | control | delete |
| `GET /api/agent/isos` | read | ISO library |
| `GET /api/agent/events` · `tasks` | read | audit/task feed |

Creation accepts both camelCase and snake_case fields:

```json
{
  "name": "web-01",
  "cpus": 2,
  "memory_mb": 2048,
  "disk_gb": 20,
  "disk_bus": "virtio",
  "iso_path": "/var/lib/emuman/isos/alpine-virt.iso",
  "boot_from": "cdrom",
  "firmware": "bios",
  "ssh_user": "root",
  "start": true,
  "autostart": false
}
```

## Security notes

- Use HTTPS or a local tunnel for tokens; they are bearer credentials.
- Grant the minimum scopes: most read-only agents need only `read`; give `console` exclusively to
  agents that must operate the GUI; `control` and `exec` are high-impact.
- Revoke tokens from **Agents**; revocation is immediate.
- The API intentionally has no built-in rate limiting. Put internet-facing deployments behind a
  reverse proxy with request limits, and keep `EMUMAN_HOST=127.0.0.1`.
- Agent actions are written to the audit log; `agent.exec` records the command and exit code, not
  credentials.
- CORS on agent routes uses `Access-Control-Allow-Origin: *` because authentication is header-based
  and no cookies are involved. Restrict at the proxy if you need origin allow-listing.
