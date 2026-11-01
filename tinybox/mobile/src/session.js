import { createContext, useContext } from 'react';

export const Session = createContext(null);
export const useSession = () => useContext(Session);
