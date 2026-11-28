"use client";

import { useEffect, useState, useCallback } from "react";

// Telegram WebApp window interface definition
interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    query_id?: string;
    user?: TelegramUser;
    auth_date?: string;
    hash?: string;
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    setText: (text: string) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  switchInlineQuery: (query: string, choose_chat_types?: string[]) => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const WALLET_PATH = /^\/(?:wallet(?:-lab)?|vault)(?:\/|$)/;
const TG_SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js";

function inTelegramContext(): boolean {
  if (typeof window === "undefined" || WALLET_PATH.test(window.location.pathname)) return false;
  if (window.Telegram?.WebApp) return true;
  if ((window as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy !== undefined) return true;
  const params = `${window.location.search}${window.location.hash}`;
  return /tgWebApp(?:Data|Platform|Version)=/.test(params);
}

export function useTelegram() {
  const [tg, setTg] = useState<TelegramWebApp | null>(null);
  const [isTelegram, setIsTelegram] = useState(false);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [startParam, setStartParam] = useState<string | null>(null);

  useEffect(() => {
    if (!inTelegramContext()) return;
    let live = true;
    const attach = () => {
      if (!live) return;
      const webapp = window.Telegram?.WebApp;
      if (!webapp || !webapp.initData) return;
      setTg(webapp);
      setIsTelegram(true);
      try {
        webapp.ready();
        webapp.expand();
        if (webapp.setHeaderColor) webapp.setHeaderColor("#0B0F14");
        if (webapp.setBackgroundColor) webapp.setBackgroundColor("#0B0F14");
      } catch {}
      if (webapp.initDataUnsafe?.user) setUser(webapp.initDataUnsafe.user);
      if (webapp.initDataUnsafe?.start_param) setStartParam(webapp.initDataUnsafe.start_param);
    };

    if (window.Telegram?.WebApp) {
      attach();
      return () => { live = false; };
    }
    // Load Telegram's SDK only when actually inside a Telegram Mini App (never on normal or wallet pages).
    let script = document.querySelector<HTMLScriptElement>(`script[src="${TG_SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = TG_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", attach);
    return () => { live = false; script?.removeEventListener("load", attach); };
  }, []);

  const haptic = useCallback(
    (type: "light" | "medium" | "heavy" | "success" | "error" | "select" = "medium") => {
      try {
        if (tg?.HapticFeedback) {
          if (type === "success" || type === "error") {
            tg.HapticFeedback.notificationOccurred(type);
          } else if (type === "select") {
            tg.HapticFeedback.selectionChanged();
          } else {
            tg.HapticFeedback.impactOccurred(type);
          }
          return;
        }
      } catch {}

      // Fallback to standard web vibration API
      try {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          if (type === "success") navigator.vibrate([15, 30, 60]);
          else if (type === "error") navigator.vibrate([40, 40, 80]);
          else navigator.vibrate(20);
        }
      } catch {}
    },
    [tg]
  );

  const shareToTelegram = useCallback(
    (text: string, url: string) => {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(shareUrl);
      } else if (typeof window !== "undefined") {
        window.open(shareUrl, "_blank", "noopener,noreferrer");
      }
    },
    [tg]
  );

  return {
    tg,
    isTelegram,
    user,
    startParam,
    haptic,
    shareToTelegram,
  };
}
