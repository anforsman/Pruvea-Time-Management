"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import type { Locale } from "./i18n";

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
}>({ locale: "en", setLocale: () => {} });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("pruvea-locale") as Locale) || "en";
    }
    return "en";
  });

  function handleSetLocale(l: Locale) {
    setLocale(l);
    if (typeof window !== "undefined") {
      localStorage.setItem("pruvea-locale", l);
    }
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale: handleSetLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
