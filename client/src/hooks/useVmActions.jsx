import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

export function useVmActions() {
  const toast = useToast();
  const confirm = useConfirm();
  const { refreshVms } = useData();
  const navigate = useNavigate();

  const act = useCallback(
    async (vm, action, { success, failure } = {}) => {
      try {
        await api.post(`/api/vms/${vm.id}/action`, { action });
        toast.success(success || `${vm.name}: ${action} sent`);
        refreshVms();
        return true;
      } catch (err) {
        toast.error(failure || err.message, { title: vm.name });
        return false;
      }
    },
    [toast, refreshVms],
  );

  const start = useCallback(
    (vm) => act(vm, 'start', { success: `${vm.name} is starting` }),
    [act],
  );

  const shutdown = useCallback(
    async (vm) => {
      const ok = await confirm({
        title: `Shut down ${vm.name}?`,
        message:
          'An ACPI power button event is sent to the guest. Make sure the guest is configured to handle it gracefully.',
        confirmLabel: 'Send shutdown',
        danger: false,
      });
      if (!ok) return false;
      return act(vm, 'shutdown', {
        success: `Shutdown requested for ${vm.name}`,
        failure: 'Could not request shutdown',
      });
    },
    [act, confirm],
  );

  const stop = useCallback(
    async (vm) => {
      const ok = await confirm({
        title: `Force stop ${vm.name}?`,
        message: 'This is equivalent to pulling the power cord. Unsaved data inside the guest may be lost.',
        confirmLabel: 'Force stop',
        danger: true,
      });
      if (!ok) return false;
      return act(vm, 'stop', {
        success: `${vm.name} stopped`,
        failure: 'Could not stop the machine',
      });
    },
    [act, confirm],
  );

  const reboot = useCallback(
    async (vm) => {
      const ok = await confirm({
        title: `Reboot ${vm.name}?`,
        message: 'The virtual machine will be reset immediately (hard reset).',
        confirmLabel: 'Reboot',
        danger: false,
      });
      if (!ok) return false;
      return act(vm, 'reboot', { success: `Reboot signal sent to ${vm.name}` });
    },
    [act, confirm],
  );

  const pause = useCallback(
    (vm) => act(vm, 'pause', { success: `${vm.name} paused` }),
    [act],
  );
  const resume = useCallback(
    (vm) => act(vm, 'resume', { success: `${vm.name} resumed` }),
    [act],
  );

  const remove = useCallback(
    async (vm, { onDeleted } = {}) => {
      const ok = await confirm({
        title: `Delete ${vm.name}?`,
        message:
          'The virtual machine configuration, attached disks and console logs will be removed from this host. This cannot be undone.',
        confirmLabel: 'Delete machine',
        danger: true,
        details: (
          <span>
            {Array.isArray(vm.disks) ? vm.disks.length : vm.disks || 0} disk
            {(Array.isArray(vm.disks) ? vm.disks.length : vm.disks) === 1 ? '' : 's'} · {vm.cpus} vCPU ·{' '}
            {vm.memoryMB} MB RAM
          </span>
        ),
      });
      if (!ok) return false;
      try {
        await api.del(`/api/vms/${vm.id}`);
        toast.success(`${vm.name} deleted`);
        refreshVms();
        onDeleted?.();
        return true;
      } catch (err) {
        toast.error(err.message, { title: 'Delete failed' });
        return false;
      }
    },
    [confirm, toast, refreshVms],
  );

  const clone = useCallback(
    async (vm, name) => {
      try {
        const copy = await api.post(`/api/vms/${vm.id}/clone`, { name });
        toast.success(`Clone created: ${copy.name}`);
        refreshVms();
        navigate(`/vms/${copy.id}`);
        return copy;
      } catch (err) {
        toast.error(err.message, { title: 'Clone failed' });
        return null;
      }
    },
    [toast, refreshVms, navigate],
  );

  return { start, shutdown, stop, reboot, pause, resume, remove, clone, act };
}
