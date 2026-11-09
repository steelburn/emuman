import { authenticateAgent, applyAgentCors, preflight, hasScope } from './agent/auth.js';
import * as service from './agent/service.js';
import { VERSION } from './env.js';
import { log } from './log.js';

const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];

const vmId = { type: 'string', description: 'Virtual machine ID (from emuman_list_vms).' };

function tool(name, scope, description, inputSchema, handler) {
  return { name, scope, description, inputSchema, handler };
}

const TOOLS = [
  tool(
    'emuman_list_vms',
    'read',
    'List KVM/QEMU virtual machines with status, CPU, memory, disk, VNC/SSH ports and uptime.',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => ({ vms: service.listVms() }),
  ),
  tool(
    'emuman_list_isos',
    'read',
    'List installation images in the emuman ISO library (name, absolute path, size).',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => ({ isos: await service.listIsos() }),
  ),
  tool(
    'emuman_get_vm',
    'read',
    'Get full configuration, disks, runtime state and console endpoints for one VM.',
    { type: 'object', properties: { vm_id: vmId }, required: ['vm_id'], additionalProperties: false },
    async (args) => service.getVm(args.vm_id),
  ),
  tool(
    'emuman_vm_action',
    'control',
    'Start, gracefully shut down, force stop, reboot, pause or resume a VM. Optionally wait for a target status.',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        action: { type: 'string', enum: ['start', 'shutdown', 'stop', 'reboot', 'pause', 'resume'] },
        wait_ms: { type: 'number', description: 'Wait up to this long for the expected state (0-15000).', default: 5000 },
      },
      required: ['vm_id', 'action'],
      additionalProperties: false,
    },
    async (args, agent) =>
      service.vmAction(args.vm_id, args.action, { actor: agent.name, waitMs: args.wait_ms ?? 5000 }),
  ),
  tool(
    'emuman_create_vm',
    'control',
    'Create a VM. Optionally attach an ISO from the library, create a qcow2 disk and start it.',
    {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        cpus: { type: 'number', default: 2 },
        memory_mb: { type: 'number', default: 2048 },
        disk_gb: { type: 'number', default: 20 },
        disk_bus: { type: 'string', enum: ['virtio', 'sata'], default: 'virtio' },
        iso_path: { type: 'string', description: 'Absolute path inside the emuman ISO library.' },
        firmware: { type: 'string', enum: ['bios', 'efi'], default: 'bios' },
        boot_from: { type: 'string', enum: ['disk', 'cdrom'], default: 'cdrom' },
        ssh_user: { type: 'string', default: 'root' },
        start: { type: 'boolean', default: true },
        autostart: { type: 'boolean', default: false },
      },
      required: ['name'],
      additionalProperties: false,
    },
    async (args, agent) =>
      service.createVm(
        {
          name: args.name,
          description: args.description,
          cpus: args.cpus,
          memoryMB: args.memory_mb,
          diskGB: args.disk_gb,
          diskBus: args.disk_bus,
          isoPath: args.iso_path,
          firmware: args.firmware,
          bootFrom: args.boot_from,
          sshUser: args.ssh_user,
          autostart: args.autostart,
          start: args.start,
        },
        { actor: agent.name },
      ),
  ),
  tool(
    'emuman_delete_vm',
    'control',
    'Permanently delete a VM, its disks, snapshots and logs.',
    { type: 'object', properties: { vm_id: vmId }, required: ['vm_id'], additionalProperties: false },
    async (args, agent) => service.deleteVm(args.vm_id, { actor: agent.name }),
  ),
  tool(
    'emuman_clone_vm',
    'control',
    'Clone a stopped VM (full disk copy, new IDs, MAC and ports).',
    {
      type: 'object',
      properties: { vm_id: vmId, name: { type: 'string' } },
      required: ['vm_id'],
      additionalProperties: false,
    },
    async (args, agent) => service.cloneVm(args.vm_id, { name: args.name, actor: agent.name }),
  ),
  tool(
    'emuman_screenshot',
    'console',
    'Capture the VM framebuffer as a PNG image. Use the returned width/height to compute click coordinates. Call this first for computer-use tasks.',
    {
      type: 'object',
      properties: { vm_id: vmId },
      required: ['vm_id'],
      additionalProperties: false,
    },
    async (args) => {
      const shot = await service.screenshot(args.vm_id);
      return {
        __mcpContent: true,
        content: [
          { type: 'image', data: shot.buffer.toString('base64'), mimeType: 'image/png' },
          {
            type: 'text',
            text: JSON.stringify({ vm_id: args.vm_id, width: shot.width, height: shot.height, format: 'png' }),
          },
        ],
      };
    },
  ),
  tool(
    'emuman_screen_info',
    'console',
    'Return the current framebuffer resolution and whether the VM is running.',
    { type: 'object', properties: { vm_id: vmId }, required: ['vm_id'], additionalProperties: false },
    async (args) => ({ ...(await service.display(args.vm_id)), status: service.vmStatus(args.vm_id) }),
  ),
  tool(
    'emuman_move_mouse',
    'console',
    'Move the absolute pointer to pixel coordinates inside the VM display.',
    {
      type: 'object',
      properties: { vm_id: vmId, x: { type: 'number' }, y: { type: 'number' } },
      required: ['vm_id', 'x', 'y'],
      additionalProperties: false,
    },
    async (args, agent) => service.input(args.vm_id, { type: 'move', x: args.x, y: args.y }, agent),
  ),
  tool(
    'emuman_click',
    'console',
    'Click (or double/triple click) at pixel coordinates. Omit x/y to click the current pointer position.',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        clicks: { type: 'number', minimum: 1, maximum: 5, default: 1 },
      },
      required: ['vm_id'],
      additionalProperties: false,
    },
    async (args) =>
      service.input(args.vm_id, {
        type: 'click',
        x: args.x,
        y: args.y,
        button: args.button,
        clicks: args.clicks,
      }),
  ),
  tool(
    'emuman_drag',
    'console',
    'Drag the pointer between two pixel coordinates with a held mouse button.',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        from_x: { type: 'number' },
        from_y: { type: 'number' },
        to_x: { type: 'number' },
        to_y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
      },
      required: ['vm_id', 'from_x', 'from_y', 'to_x', 'to_y'],
      additionalProperties: false,
    },
    async (args) =>
      service.input(args.vm_id, {
        type: 'drag',
        fromX: args.from_x,
        fromY: args.from_y,
        toX: args.to_x,
        toY: args.to_y,
        button: args.button,
      }),
  ),
  tool(
    'emuman_scroll',
    'console',
    'Scroll the mouse wheel inside the VM. Positive dy scrolls down.',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        dy: { type: 'number', default: 1 },
        dx: { type: 'number', default: 0 },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['vm_id'],
      additionalProperties: false,
    },
    async (args) =>
      service.input(args.vm_id, { type: 'scroll', dy: args.dy ?? 1, dx: args.dx ?? 0, x: args.x, y: args.y }),
  ),
  tool(
    'emuman_type_text',
    'console',
    'Type ASCII text into the focused guest window using keyboard events. Use \\n for Enter.',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        text: { type: 'string', description: 'Text to type (ASCII, max 2000 chars).' },
        interval_ms: { type: 'number', description: 'Delay between characters (0-200 ms).', default: 18 },
      },
      required: ['vm_id', 'text'],
      additionalProperties: false,
    },
    async (args) =>
      service.input(args.vm_id, {
        type: 'type',
        text: args.text,
        intervalMs: args.interval_ms,
      }),
  ),
  tool(
    'emuman_press_keys',
    'console',
    'Press a key combination such as "ctrl+alt+del", "enter", "tab", "f2" or "ctrl+c".',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        keys: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'A "+" separated combo or an array of key names.',
        },
      },
      required: ['vm_id', 'keys'],
      additionalProperties: false,
    },
    async (args) => service.input(args.vm_id, { type: 'key', keys: args.keys }),
  ),
  tool(
    'emuman_serial_read',
    'console',
    'Read the buffered serial console output (ttyS0) from a VM.',
    {
      type: 'object',
      properties: { vm_id: vmId, limit: { type: 'number', default: 65536 } },
      required: ['vm_id'],
      additionalProperties: false,
    },
    async (args) => service.serialRead(args.vm_id, { limit: args.limit }),
  ),
  tool(
    'emuman_serial_send',
    'console',
    'Send text to the VM serial console. append_newline=true submits the line with a carriage return (serial login/shells expect CR).',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        text: { type: 'string' },
        append_newline: { type: 'boolean', default: true },
      },
      required: ['vm_id', 'text'],
      additionalProperties: false,
    },
    async (args) =>
      service.serialWrite(args.vm_id, {
        text: args.text,
        appendNewline: args.append_newline !== false,
      }),
  ),
  tool(
    'emuman_exec',
    'exec',
    'Run a command inside a guest over SSH using the VM saved credentials or supplied password/key. Returns stdout, stderr and exit code.',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        command: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
        private_key: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        timeout_ms: { type: 'number', default: 30000 },
      },
      required: ['vm_id', 'command'],
      additionalProperties: false,
    },
    async (args, agent) =>
      service.execInGuest(
        args.vm_id,
        {
          command: args.command,
          username: args.username,
          password: args.password,
          privateKey: args.private_key,
          host: args.host,
          port: args.port,
          timeoutMs: args.timeout_ms,
        },
        { actor: agent.name },
      ),
  ),
  tool(
    'emuman_list_snapshots',
    'read',
    'List qcow2 snapshots for a VM.',
    { type: 'object', properties: { vm_id: vmId }, required: ['vm_id'], additionalProperties: false },
    async (args) => ({ snapshots: await service.listSnapshots(args.vm_id) }),
  ),
  tool(
    'emuman_create_snapshot',
    'control',
    'Create a snapshot (disk and, when running, VM RAM/device state).',
    {
      type: 'object',
      properties: { vm_id: vmId, name: { type: 'string' } },
      required: ['vm_id', 'name'],
      additionalProperties: false,
    },
    async (args, agent) => service.createSnapshot(args.vm_id, args.name, { actor: agent.name }),
  ),
  tool(
    'emuman_restore_snapshot',
    'control',
    'Restore a snapshot, booting the saved VM state.',
    {
      type: 'object',
      properties: { vm_id: vmId, name: { type: 'string' } },
      required: ['vm_id', 'name'],
      additionalProperties: false,
    },
    async (args, agent) => service.restoreSnapshot(args.vm_id, args.name, { actor: agent.name }),
  ),
  tool(
    'emuman_vm_logs',
    'read',
    'Read the QEMU process log or serial log for a VM.',
    {
      type: 'object',
      properties: {
        vm_id: vmId,
        type: { type: 'string', enum: ['qemu', 'serial'], default: 'qemu' },
        limit: { type: 'number', default: 131072 },
      },
      required: ['vm_id'],
      additionalProperties: false,
    },
    async (args) => service.logs(args.vm_id, { type: args.type, limit: args.limit }),
  ),
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

const INSTRUCTIONS = `emuman manages KVM/QEMU machines on a single host.
Use emuman_list_vms to find machines. For computer-use:
1) emuman_screenshot returns a PNG plus width/height.
2) Compute pixel coordinates from that image and call emuman_click / emuman_type_text / emuman_press_keys.
3) Call emuman_screenshot again to verify the result.
For headless guests, emuman_serial_read/emuman_serial_send or emuman_exec (SSH) are more reliable.
Lifecycle changes require the "control" scope; screen and input require "console".`;

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: String(message) }] };
}

function toolText(value) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

function toolsFor(agent) {
  return TOOLS.filter((t) => hasScope(agent, t.scope)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function handleRpc(msg, agent) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id ?? null, -32600, 'Invalid JSON-RPC request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const method = msg.method;

  if (method === 'initialize') {
    const requested = msg.params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : '2025-03-26';
    log.info('mcp', `${agent.name} initialized (MCP ${protocolVersion})`);
    return rpcResult(msg.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'emuman', version: VERSION },
      instructions: INSTRUCTIONS,
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null;
  }
  if (method === 'ping') return rpcResult(msg.id, {});
  if (method === 'tools/list') {
    return rpcResult(msg.id, { tools: toolsFor(agent) });
  }
  if (method === 'tools/call') {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    const toolDef = TOOL_MAP.get(name);
    if (!toolDef) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
    if (!hasScope(agent, toolDef.scope)) {
      return rpcResult(
        msg.id,
        toolError(
          `Tool ${name} requires the "${toolDef.scope}" scope. This token has: ${agent.scopes.join(', ')}`,
        ),
      );
    }
    try {
      const result = await toolDef.handler(args, agent);
      log.info('mcp', `${agent.name} called ${name}`);
      if (result?.__mcpContent) return rpcResult(msg.id, { content: result.content });
      return rpcResult(msg.id, toolText(result));
    } catch (err) {
      log.warn('mcp', `${agent.name} ${name} failed: ${err.message}`);
      return rpcResult(msg.id, toolError(err.message || 'Tool failed'));
    }
  }
  if (isNotification) return null;
  return rpcError(msg.id, -32601, `Method not found: ${method}`);
}

export default async function mcpRoutes(app) {
  app.addHook('onSend', async (req, reply, payload) => {
    applyAgentCors(reply);
    reply.header('Mcp-Protocol-Version', '2025-03-26');
    return payload;
  });

  app.options('/mcp', async (req, reply) => preflight(reply));

  app.get('/mcp', async (req, reply) => {
    applyAgentCors(reply);
    reply.header('Allow', 'POST, DELETE, OPTIONS');
    return reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'SSE stream not offered; use POST' }, id: null });
  });

  app.delete('/mcp', async (req, reply) => {
    applyAgentCors(reply);
    return reply.code(204).send();
  });

  app.post('/mcp', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const auth = authenticateAgent(req);
    if (!auth.agent) {
      reply.header('WWW-Authenticate', 'Bearer');
      return reply.code(auth.status || 401).send({
        jsonrpc: '2.0',
        error: { code: -32001, message: auth.error || 'Unauthorized' },
        id: null,
      });
    }
    if (!req.body || (typeof req.body !== 'object' && !Array.isArray(req.body))) {
      return reply.code(400).send(rpcError(null, -32700, 'Expected a JSON-RPC body'));
    }
    const isBatch = Array.isArray(req.body);
    const messages = isBatch ? req.body : [req.body];
    const responses = [];
    for (const message of messages) {
      const response = await handleRpc(message, auth.agent);
      if (response) responses.push(response);
    }
    if (!responses.length) return reply.code(202).send();
    const payload = isBatch ? responses : responses[0];
    if (String(req.headers.accept || '').includes('text/event-stream')) {
      reply.type('text/event-stream');
      reply.header('Cache-Control', 'no-cache');
      return reply.send(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    }
    return reply.code(200).send(payload);
  });
}
