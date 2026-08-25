"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "pt" | "en" | "es";
const STORAGE_KEY = "batuta.locale";
const HTML_LANG: Record<Locale, string> = { pt: "pt-BR", en: "en", es: "es" };

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>("pt");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "pt" || saved === "en" || saved === "es") setLocale(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
