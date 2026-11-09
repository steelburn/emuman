import { Info, Network, TerminalSquare } from 'lucide-react';
import SshConsole from '../../components/SshConsole.jsx';

export default function VmSshTab({ vm, detail }) {
  const port = vm.net?.sshPort || vm.sshPort;
  const user = vm.ssh?.user || vm.sshUser || 'root';
  const hasSavedPassword = Boolean(vm.hasSavedSshPassword || detail?.vm?.hasSavedSshPassword);
  const bridgeMode = vm.net?.mode === 'bridge';

  if (bridgeMode) {
    return (
      <div className="alert alert-warn">
        <Info size={15} />
        <span>
          This machine uses bridged networking, so no automatic SSH forward exists. Connect to the
          guest&apos;s own bridge IP with the terminal below or from the host network.
        </span>
      </div>
    );
  }

  return (
    <div>
      <SshConsole
        vmId={vm.id}
        defaults={{
          host: '127.0.0.1',
          port,
          username: user,
          hasSavedPassword,
          note: `Traffic is forwarded from 127.0.0.1:${port} on the emuman host to port 22 (or the configured port) inside ${vm.name}. The guest must be running sshd.`,
        }}
      />
      <div className="callout-grid mt-16">
        <div className="callout">
          <span className="callout-icon">
            <Network size={15} />
          </span>
          <div>
            <h4>Port forward</h4>
            <p>
              QEMU user networking exposes <code className="tiny">127.0.0.1:{port}</code> on this
              host. Change the forwarded port under Settings → Networking.
            </p>
          </div>
        </div>
        <div className="callout">
          <span className="callout-icon">
            <TerminalSquare size={15} />
          </span>
          <div>
            <h4>Terminal features</h4>
            <p>
              Full vt100/xterm emulation with copy-on-select, scrollback and automatic resize.
              Credentials can be remembered per VM, encrypted at rest with AES-256-GCM.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
