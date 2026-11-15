'use client';
import React, { createContext, useContext, useEffect, useMemo, useState, } from 'react';
const ThemeContext = createContext(null);
function applyThemeClass(theme) {
    if (typeof document === 'undefined')
        return;
    const root = document.documentElement;
    if (theme === 'dark')
        root.classList.add('dark');
    else
        root.classList.remove('dark');
}
export function ThemeProvider({ children, }) {
    const [theme, setThemeState] = useState('light');
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        try {
            const stored = localStorage.getItem('theme');
            const systemDark = window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: dark)').matches;
            const initial = stored === 'dark' || stored === 'light'
                ? stored
                : systemDark
                    ? 'dark'
                    : 'light';
            setThemeState(initial);
            applyThemeClass(initial);
            if (!stored && window.matchMedia) {
                const mq = window.matchMedia('(prefers-color-scheme: dark)');
                const handler = (e) => {
                    const next = e.matches ? 'dark' : 'light';
                    setThemeState(next);
                    applyThemeClass(next);
                };
                mq.addEventListener('change', handler);
                return () => mq.removeEventListener('change', handler);
            }
        }
        finally {
            setMounted(true);
        }
    }, []);
    const setTheme = (t) => {
        setThemeState(t);
        try {
            localStorage.setItem('theme', t);
        }
        catch { }
        applyThemeClass(t);
    };
    const value = useMemo(() => ({
        theme,
        setTheme,
        toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    }), [theme]);
    if (!mounted)
        return <>{children}</>;
    return (<ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>);
}
export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx)
        throw new Error('useTheme must be used within ThemeProvider');
    return ctx;
}
