/**
 * Central role and permission model for emuman.
 *
 * Roles are ordered by privilege. Every API route and WebSocket surface checks a
 * permission from this table (see requirePermission below), so the client-side
 * UI is only a convenience layer — never the security boundary.
 */

export const PERMISSIONS = {
  'vm.read': 'View virtual machines, metrics, logs and screenshots',
  'vm.operate': 'Start, stop, pause, reboot and snapshot machines',
  'vm.manage': 'Create, edit, clone and delete machines, disks and ISO attachments',
  'vm.console.view': 'Attach to VNC and serial consoles',
  'vm.console.input': 'Send keyboard, mouse and serial input to guests',
  'vm.ssh': 'Open SSH terminals to guests and the host',
  'iso.manage': 'Upload and delete ISO images',
  'host.read': 'View host information, storage and tasks',
  'host.settings': 'Change host settings, QEMU paths and trusted SSH host keys',
  'host.logs': 'Read the emuman server runtime log',
  'audit.read': 'Read the audit log',
  'agents.manage': 'Create and revoke API/MCP agent tokens',
  'users.manage': 'Create, edit, disable and delete user accounts',
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

export const ROLES = {
  admin: {
    id: 'admin',
    label: 'Administrator',
    rank: 30,
    tone: 'danger',
    description: 'Full control of this host, including users, roles and host settings.',
    permissions: ['*'],
  },
  operator: {
    id: 'operator',
    label: 'Operator',
    rank: 20,
    tone: 'accent',
    description: 'Runs machines: power control, consoles, SSH, disks, snapshots and ISOs.',
    permissions: [
      'vm.read',
      'vm.operate',
      'vm.manage',
      'vm.console.view',
      'vm.console.input',
      'vm.ssh',
      'iso.manage',
      'host.read',
      'audit.read',
    ],
  },
  viewer: {
    id: 'viewer',
    label: 'Viewer',
    rank: 10,
    tone: 'neutral',
    description: 'Read-only access. Consoles attach view-only and SSH is blocked.',
    permissions: ['vm.read', 'vm.console.view', 'host.read', 'audit.read'],
  },
};

export const ROLE_IDS = Object.keys(ROLES);

export function normalizeRole(role) {
  if (ROLE_IDS.includes(role)) return role;
  // Legacy databases created before roles existed only contain administrators.
  return role ? 'viewer' : 'admin';
}

export function roleFor(user) {
  return ROLES[normalizeRole(user?.role)];
}

export function permissionsFor(role) {
  const meta = ROLES[normalizeRole(role)];
  return meta.permissions.includes('*') ? [...ALL_PERMISSIONS] : [...meta.permissions];
}

export function can(user, permission) {
  if (!user || user.disabledAt) return false;
  const meta = roleFor(user);
  if (meta.permissions.includes('*')) return true;
  return meta.permissions.includes(permission);
}

export function isAdmin(user) {
  return normalizeRole(user?.role) === 'admin';
}

export function roleCatalog() {
  return ROLE_IDS.map((id) => {
    const meta = ROLES[id];
    return {
      id,
      label: meta.label,
      rank: meta.rank,
      tone: meta.tone,
      description: meta.description,
      permissions: permissionsFor(id),
      permissionDetails: permissionsFor(id).map((permission) => ({
        id: permission,
        description: PERMISSIONS[permission],
      })),
    };
  }).sort((a, b) => b.rank - a.rank);
}

/**
 * Fastify preHandler factory. Expects the global auth hook to have populated
 * req.user already.
 */
export function requirePermission(permission) {
  return async function checkPermission(req, reply) {
    if (!req.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (!can(req.user, permission)) {
      return reply.code(403).send({
        error: `Your role (${roleFor(req.user).label}) cannot perform this action`,
        code: 'FORBIDDEN',
        permission,
      });
    }
  };
}
