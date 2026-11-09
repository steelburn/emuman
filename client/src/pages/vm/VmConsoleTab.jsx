import { Keyboard, Lock, MonitorPlay, TerminalSquare } from 'lucide-react';
import VncConsole from '../../components/VncConsole.jsx';

export default function VmConsoleTab({ vm, running, onStart, setTab, viewOnly = false }) {
  return (
    <div>
      <VncConsole vmId={vm.id} vm={vm} running={running} onStart={onStart} viewOnly={viewOnly} />
      <div className="callout-grid mt-16">
        <div className="callout">
          <span className="callout-icon">
            <Keyboard size={15} />
          </span>
          <div>
            <h4>{viewOnly ? 'View-only session' : 'Keyboard & mouse'}</h4>
            <p>
              {viewOnly
                ? 'Your role can watch this console but cannot send keyboard or mouse input. Ask an administrator for the Operator or Administrator role if you need control.'
                : 'Click the framebuffer to capture input. Use the toolbar for Ctrl+Alt+Del, or press the browser fullscreen button for an immersive session.'}
            </p>
          </div>
        </div>
        <div className="callout">
          <span className="callout-icon">
            <Lock size={15} />
          </span>
          <div>
            <h4>Protected transport</h4>
            <p>
              QEMU binds VNC to 127.0.0.1 and emuman proxies it over an authenticated, same-origin
              WebSocket — no extra port needs to be exposed.
            </p>
          </div>
        </div>
        <div className="callout" style={{ cursor: 'pointer' }} onClick={() => setTab('serial')}>
          <span className="callout-icon">
            <TerminalSquare size={15} />
          </span>
          <div>
            <h4>Text-only alternative</h4>
            <p>
              For headless guests, the serial console is lighter and survives a broken graphical
              driver. Open ttyS0 →
            </p>
          </div>
        </div>
      </div>
      <div className="console-hint mt-16">
        <MonitorPlay size={14} />
        <span>
          If the display stays black, the guest may still be booting, or its video adapter does not
          match the VM configuration. Check the QEMU log under the Logs tab.
        </span>
      </div>
    </div>
  );
}
