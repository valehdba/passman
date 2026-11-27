import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/client.js";
import { usePreferences } from "../stores/preferences.js";
import { useSession } from "../stores/session.js";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

/**
 * Locks the vault after the user's idle timeout. Renders nothing; mounted once
 * inside the router so it covers every page. Locking == logging out, exactly
 * like the Lock button: best-effort server logout, then drop the in-memory
 * session and go to /login.
 */
export function AutoLock() {
  const nav = useNavigate();
  const minutes = usePreferences((s) => s.autoLockMinutes);
  const unlocked = useSession((s) => s.accessToken !== null);

  useEffect(() => {
    if (!unlocked || minutes <= 0) return;
    let timer: number | undefined;

    const lock = () => {
      const { accessToken, refreshToken, clear } = useSession.getState();
      if (accessToken && refreshToken) {
        void api.logout(accessToken, refreshToken).catch(() => {
          /* local clear is what matters */
        });
      }
      clear();
      nav("/login");
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, minutes * 60_000);
    };

    arm();
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, arm, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, arm);
    };
  }, [unlocked, minutes, nav]);

  return null;
}
