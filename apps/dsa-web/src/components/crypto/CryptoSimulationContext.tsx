import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CryptoBacktest } from '../../api/crypto';

const Context = createContext<{ result: CryptoBacktest | null; setResult: (value: CryptoBacktest | null) => void }>({ result: null, setResult: () => undefined });

export function CryptoSimulationProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<CryptoBacktest | null>(null);
  return <Context.Provider value={{ result, setResult }}>{children}</Context.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook stays with its provider
export const useCryptoSimulation = () => useContext(Context);
