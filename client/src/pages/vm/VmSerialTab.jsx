import { Info, TerminalSquare } from 'lucide-react';
import SerialConsole from '../../components/SerialConsole.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function VmSerialTab({ vm, running }) {
  const { can } = useAuth();
  const readOnly = !can('vm.console.input');
  return (
    <div>
      <SerialConsole
        vmId={vm.id}
        running={running}
        readOnly={readOnly}
        height={Math.min(620, Math.max(360, window.innerHeight - 380))}
      />
      <div className="callout-grid mt-16">
        <div className="callout">
          <span className="callout-icon">
            <TerminalSquare size={15} />
          </span>
          <div>
            <h4>Guest configuration</h4>
            <p>
              For Linux guests, add <code>console=ttyS0</code> to the kernel command line (and keep
              a getty on ttyS0) to use this console. QEMU logs serial output to disk continuously.
            </p>
          </div>
        </div>
        <div className="callout">
          <span className="callout-icon">
            <Info size={15} />
          </span>
          <div>
            <h4>One client at a time</h4>
            <p>
              The QEMU chardev socket accepts a single attached client. If another session is
              connected, close it or use the buffered log view.
              {readOnly ? ' Your role can watch this console but cannot type.' : ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
