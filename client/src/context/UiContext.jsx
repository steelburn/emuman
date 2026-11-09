import { createContext, useContext, useMemo, useState } from 'react';

const UiContext = createContext(null);

export function UiProvider({ children }) {
  const [createVmOpen, setCreateVmOpen] = useState(false);
  const value = useMemo(
    () => ({
      createVmOpen,
      openCreateVm: () => setCreateVmOpen(true),
      closeCreateVm: () => setCreateVmOpen(false),
    }),
    [createVmOpen],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}
