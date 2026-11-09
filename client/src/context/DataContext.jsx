import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, wsUrl } from '../lib/api.js';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [host, setHost] = useState(null);
  const [vms, setVms] = useState([]);
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [liveMessage, setLiveMessage] = useState(null);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const refreshTimer = useRef(null);
  const mounted = useRef(true);

  const refreshVms = useCallback(async () => {
    try {
      const data = await api.get('/api/vms');
      if (!mounted.current) return;
      setVms(data.vms || []);
      setTasks(data.tasks || []);
    } catch (err) {
      if (!mounted.current) return;
      if (err.status === 401) window.location.assign('/login');
      setError(err.message);
    }
  }, []);

  const refreshHost = useCallback(async () => {
    try {
      const data = await api.get('/api/host/info');
      if (mounted.current) setHost(data);
    } catch {
      /* ignore */
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hostData, vmsData, eventData, taskData] = await Promise.all([
        api.get('/api/host/info'),
        api.get('/api/vms'),
        api.get('/api/host/events?limit=80'),
        api.get('/api/host/tasks?limit=20'),
      ]);
      if (!mounted.current) return;
      setHost(hostData);
      setVms(vmsData.vms || []);
      setEvents(eventData.events || []);
      setTasks(taskData.tasks?.length ? taskData.tasks : vmsData.tasks || []);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      if (err.status === 401) {
        window.location.assign('/login');
        return;
      }
      setError(err.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadAll();
    const poll = setInterval(() => {
      if (!document.hidden) refreshHost();
    }, 10000);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      wsRef.current?.close();
    };
  }, [loadAll, refreshHost]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => refreshVms(), 250);
  }, [refreshVms]);

  useEffect(() => {
    let closed = false;
    let retryTimer = null;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl('/ws/events'));
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retryRef.current = Math.min(retryRef.current + 1, 8);
        retryTimer = setTimeout(connect, 700 * retryRef.current);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case 'host-metrics':
            setHost((prev) => ({ ...(prev || {}), ...msg }));
            break;
          case 'vm-status': {
            setVms((list) =>
              list.map((vm) =>
                vm.id === msg.id
                  ? {
                      ...vm,
                      status: msg.status,
                      pid: msg.pid ?? (msg.status === 'stopped' ? null : vm.pid),
                      startedAt: msg.startedAt ?? vm.startedAt,
                      lastError: msg.lastError ?? null,
                    }
                  : vm,
              ),
            );
            if (msg.status === 'running') setLiveMessage({ type: 'vm', id: msg.id, status: 'running' });
            if (msg.status === 'stopped') setLiveMessage({ type: 'vm', id: msg.id, status: 'stopped' });
            break;
          }
          case 'vm-metrics':
            setVms((list) =>
              list.map((vm) =>
                vm.id === msg.id
                  ? {
                      ...vm,
                      status: msg.status || vm.status,
                      cpuPct: msg.cpuPct,
                      memBytes: msg.memBytes,
                      pid: msg.pid,
                    }
                  : vm,
              ),
            );
            break;
          case 'vms-changed':
          case 'vms-reloaded':
            scheduleRefresh();
            break;
          case 'task':
            setTasks((list) => {
              const next = list.filter((t) => t.id !== msg.task.id);
              return [msg.task, ...next].slice(0, 30);
            });
            break;
          case 'event':
            setEvents((list) => [msg.evt, ...list].slice(0, 200));
            break;
          default:
            break;
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [scheduleRefresh]);

  const findVm = useCallback((id) => vms.find((vm) => vm.id === id), [vms]);

  const value = useMemo(
    () => ({
      host,
      vms,
      events,
      tasks,
      connected,
      loading,
      error,
      liveMessage,
      setHost,
      setVms,
      setEvents,
      setTasks,
      refreshVms,
      refreshHost,
      loadAll,
      findVm,
    }),
    [host, vms, events, tasks, connected, loading, error, liveMessage, refreshVms, refreshHost, loadAll, findVm],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
