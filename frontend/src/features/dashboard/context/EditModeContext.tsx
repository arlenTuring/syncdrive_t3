import { createContext, useContext, type ReactNode } from 'react';

const EditModeContext = createContext(false);

export function EditModeProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

export function useEditMode() {
  return useContext(EditModeContext);
}
