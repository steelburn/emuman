import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, setupRequired: false, user: null, version: null });

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/api/auth/status');
      setState({
        loading: false,
        setupRequired: data.setupRequired,
        user: data.user,
        version: data.version,
      });
      return data;
    } catch (err) {
      setState({ loading: false, setupRequired: false, user: null, version: null, error: err.message });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setState((s) => ({ ...s, user: null }));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      logout,
      can: (permission) => {
        if (!state.user) return false;
        const perms = state.user.permissions || [];
        return perms.includes('*') || perms.includes(permission);
      },
      setUser: (user) => setState((s) => ({ ...s, user })),
    }),
    [state, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
