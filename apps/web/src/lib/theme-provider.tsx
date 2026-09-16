'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'colorful';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('ispcrm_theme') as Theme | null;
      if (savedTheme && (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'colorful')) {
        setThemeState(savedTheme);
        applyThemeClass(savedTheme);
      } else {
        applyThemeClass('light');
      }
    } catch {
      applyThemeClass('light');
    }
    setMounted(true);
  }, []);

  const applyThemeClass = (t: Theme) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('dark', 'light', 'colorful');
    root.classList.add(t);
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('ispcrm_theme', newTheme);
    } catch {
      // Ignore
    }
    applyThemeClass(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
