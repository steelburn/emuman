import { useMemo } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bot,
  ChevronDown,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Plus,
  Server,
  Settings,
  TerminalSquare,
  UserCog,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { Dropdown, LiveDot } from './ui.jsx';
import CreateVmModal from './CreateVmModal.jsx';

const NAV_GROUPS = [
  {
    label: 'Infrastructure',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/vms', label: 'Virtual machines', icon: Server, badge: 'vms' },
      { to: '/storage', label: 'Storage & ISOs', icon: HardDrive },
    ],
  },
  {
    label: 'Access',
    items: [
      { to: '/terminal', label: 'SSH terminal', icon: TerminalSquare, permission: 'vm.ssh' },
      { to: '/agents', label: 'Agents', icon: Bot, permission: 'agents.manage' },
      { to: '/host', label: 'Host & audit', icon: Activity, permission: 'audit.read' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/users', label: 'Users & roles', icon: Users, permission: 'users.manage' },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const { vms, host, connected } = useData();
  const { openCreateVm } = useUi();
  const navigate = useNavigate();
  const location = useLocation();

  const running = vms.filter((vm) => vm.status === 'running' || vm.status === 'paused').length;

  const crumbs = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return [{ label: 'Dashboard' }];
    if (parts[0] === 'vms' && parts.length === 1) return [{ label: 'Virtual machines' }];
    if (parts[0] === 'vms' && parts[1]) {
      const vm = vms.find((v) => v.id === parts[1]);
      return [
        { label: 'Virtual machines', to: '/vms' },
        { label: vm?.name || 'Machine' },
      ];
    }
    if (parts[0] === 'storage') return [{ label: 'Storage & ISOs' }];
    if (parts[0] === 'terminal') return [{ label: 'SSH terminal' }];
    if (parts[0] === 'agents') return [{ label: 'Agents' }];
    if (parts[0] === 'users') return [{ label: 'Users & roles' }];
    if (parts[0] === 'host') return [{ label: 'Host & audit' }];
    if (parts[0] === 'settings') return [{ label: 'Settings' }];
    return [{ label: parts[0] }];
  }, [location.pathname, vms]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
          <span className="brand-mark">e</span>
          <span className="brand-text">
            <span className="brand-name">
              emu<span>man</span>
            </span>
            <span className="brand-sub">KVM control</span>
          </span>
        </Link>

        <nav className="nav">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.permission || can(item.permission));
            if (!items.length) return null;
            return (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {items.map((item) => {
                const Icon = item.icon;
                const badge =
                  item.badge === 'vms' ? (vms.length ? `${running}/${vms.length}` : '0') : null;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={17} strokeWidth={1.85} />
                    <span>{item.label}</span>
                    {badge !== null && <span className="nav-badge">{badge}</span>}
                  </NavLink>
                );
              })}
            </div>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="host-chip">
            <span className="host-chip-icon">
              <Server size={15} />
            </span>
            <span className="host-chip-text">
              <div className="host-chip-name">{host?.hostname || 'host'}</div>
              <div className="host-chip-sub">
                {host?.kvm ? 'KVM' : 'TCG'} · {host?.cpuCount || '—'} threads
              </div>
            </span>
          </div>
          <div className="sidebar-version">
            <span>emuman {host?.version || ''}</span>
            <span>QEMU {host?.qemuVersion || '—'}</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-crumbs">
            <Link to="/">emuman</Link>
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="crumb-sep">/</span>
                {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span className="current">{crumb.label}</span>}
              </span>
            ))}
          </div>

          <div className="topbar-right">
            {can('vm.manage') && (
              <button className="btn btn-primary btn-sm" onClick={openCreateVm}>
                <Plus size={14} /> New VM
              </button>
            )}
            <span className="live-indicator">
              <LiveDot connected={connected} />
              <span>{connected ? 'Live' : 'Reconnecting'}</span>
            </span>
            <Dropdown
              trigger={
                <div className="user-menu-trigger">
                  <span className={`avatar role-${user?.role || 'viewer'}`}>
                    {(user?.displayName || user?.username || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="user-menu-name">
                    {user?.displayName || user?.username}
                    <span className={`role-badge tone-${user?.role === 'admin' ? 'danger' : user?.role === 'operator' ? 'accent' : 'neutral'}`} style={{ marginLeft: 6 }}>
                      {user?.roleLabel || user?.role}
                    </span>
                  </span>
                  <ChevronDown size={14} className="muted-2" />
                </div>
              }
              items={[
                {
                  label: 'Account settings',
                  icon: <UserCog size={14} />,
                  onClick: () => navigate('/settings?tab=security'),
                },
                ...(can('users.manage')
                  ? [
                      {
                        label: 'Users & roles',
                        icon: <Users size={14} />,
                        onClick: () => navigate('/users'),
                      },
                    ]
                  : []),
                { divider: true },
                {
                  label: 'Sign out',
                  icon: <LogOut size={14} />,
                  danger: true,
                  onClick: async () => {
                    await logout();
                    navigate('/login');
                  },
                },
              ]}
            />
          </div>
        </header>

        <Outlet />
      </div>

      <CreateVmModal />
    </div>
  );
}
