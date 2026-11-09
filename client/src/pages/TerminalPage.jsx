import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MonitorPlay, Server, TerminalSquare } from 'lucide-react';
import SshConsole from '../components/SshConsole.jsx';
import { useData } from '../context/DataContext.jsx';
import { StatusPill } from '../components/ui.jsx';

export default function TerminalPage() {
  const { vms, host } = useData();
  const hostTarget = useMemo(
    () => ({
      host: '127.0.0.1',
      port: 22,
      username: host?.sshDefaultUser || 'root',
      vmId: null,
      hasSavedPassword: false,
      label: `${host?.hostname || 'this host'} (local sshd)`,
    }),
    [host?.sshDefaultUser, host?.hostname],
  );
  const [target, setTarget] = useState(hostTarget);
  const guested = vms.filter((vm) => vm.netMode === 'user' && vm.sshPort);

  const pick = (vm) => {
    setTarget({
      host: '127.0.0.1',
      port: vm.sshPort,
      username: vm.sshUser || 'root',
      vmId: vm.id,
      hasSavedPassword: Boolean(vm.hasSavedSshPassword),
      label: vm.name,
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">SSH terminal</h1>
          <p className="page-sub">
            Open an interactive shell from the emuman server to this host, a guest forward, or any
            reachable address.
          </p>
        </div>
        <div className="page-actions">
          <span className="badge">target: {target.label || `${target.host}:${target.port}`}</span>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <span className="card-title-icon">
            <Server size={15} />
          </span>
          <h3>Quick targets</h3>
          <span className="muted">SSH connections originate from the emuman host</span>
          <div className="card-head-actions">
            <button
              className={`btn btn-sm ${target.vmId === null ? 'btn-primary' : ''}`}
              onClick={() => setTarget(hostTarget)}
            >
              This host
            </button>
          </div>
        </div>
        <div className="card-body">
          {guested.length === 0 ? (
            <div className="muted small">
              No guests with SSH port forwards. Create a machine with user-mode networking, then
              install and start an SSH server inside it.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {guested.map((vm) => (
                <button
                  key={vm.id}
                  className={`btn btn-sm ${target.vmId === vm.id ? 'btn-primary' : ''}`}
                  onClick={() => pick(vm)}
                  title={`SSH ${vm.sshUser}@127.0.0.1:${vm.sshPort}`}
                >
                  <TerminalSquare size={13} />
                  {vm.name}
                  <span className="badge" style={{ marginLeft: 2 }}>
                    :{vm.sshPort}
                  </span>
                  {['running', 'paused'].includes(vm.status) ? (
                    <span className="status-dot" style={{ background: 'var(--accent)' }} />
                  ) : (
                    <span className="status-dot" style={{ background: 'var(--muted-2)' }} />
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-8 mt-12 tiny muted-2">
            <StatusPill status={host?.kvm ? 'running' : 'paused'} label={host?.kvm ? 'KVM ready' : 'emulation only'} pulse={false} />
            <span>·</span>
            <span>QEMU {host?.qemuVersion || '—'}</span>
            <span>·</span>
            <span>{host?.cpuCount || '—'} host threads</span>
          </div>
        </div>
      </div>

      <SshConsole
        key={`${target.vmId || 'host'}-${target.host}-${target.port}`}
        vmId={target.vmId}
        autoFocus
        defaults={{
          host: target.host,
          port: target.port,
          username: target.username,
          hasSavedPassword: target.hasSavedPassword,
          note:
            target.vmId
              ? `Selected guest ${target.label}. QEMU forwards 127.0.0.1:${target.port} to the guest SSH port.`
              : 'Direct SSH to the emuman host. Use the account configured in the host sshd.',
        }}
      />

      <div className="callout-grid mt-16">
        <div className="callout">
          <span className="callout-icon">
            <TerminalSquare size={15} />
          </span>
          <div>
            <h4>Encrypted bridge</h4>
            <p>
              The server opens the SSH session with ssh2, pins host keys on first use and streams
              the PTY over the authenticated console WebSocket.
            </p>
          </div>
        </div>
        <div className="callout">
          <span className="callout-icon">
            <MonitorPlay size={15} />
          </span>
          <div>
            <h4>Prefer a graphical session?</h4>
            <p>
              Open a machine&apos;s <Link to="/vms">console tab</Link> for noVNC, or use the serial
              console when the guest has no network.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
