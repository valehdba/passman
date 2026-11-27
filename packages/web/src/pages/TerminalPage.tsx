import { useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/**
 * In-browser SSH shell, opened in its own tab from the Connect dialog.
 *
 * This tab has no Passman session of its own. The opener hands it a
 * single-use ticket plus the decrypted credential over `postMessage`
 * (same-origin only, checked on both ends); the credential goes straight into
 * the first WebSocket frame and is then dropped from memory. Nothing is put in
 * the URL, localStorage or history. A reload therefore just shows the
 * "open from the vault" message.
 */

export const TERMINAL_READY = "passman-terminal-ready";
export const TERMINAL_INIT = "passman-terminal-init";

export interface TerminalInit {
  type: typeof TERMINAL_INIT;
  ticket: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  title?: string;
}

type ServerEvent =
  | { t: "status"; m: string }
  | { t: "hostkey"; fp: string; new: boolean }
  | { t: "ready" }
  | { t: "exit"; code: number | null }
  | { t: "error"; m: string };

const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

export function TerminalPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"waiting" | "running" | "orphan">("waiting");
  const [label, setLabel] = useState("");

  useEffect(() => {
    document.title = "Terminal — Passman";
    if (!window.opener) {
      setState("orphan");
      return;
    }

    let cleanup: (() => void) | undefined;
    let started = false;

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || ev.source !== window.opener) return;
      const msg = ev.data as Partial<TerminalInit> | null;
      if (!msg || msg.type !== TERMINAL_INIT || started) return;
      if (typeof msg.ticket !== "string" || typeof msg.host !== "string") return;
      started = true;
      window.removeEventListener("message", onMessage);
      cleanup = start(msg as TerminalInit);
    };
    window.addEventListener("message", onMessage);
    // Announce until the opener answers (it may still be fetching the ticket).
    const announce = () =>
      window.opener?.postMessage({ type: TERMINAL_READY }, window.location.origin);
    announce();
    const announceTimer = window.setInterval(() => {
      if (started) window.clearInterval(announceTimer);
      else announce();
    }, 400);

    function start(init: TerminalInit): () => void {
      const title = `${init.username}@${init.host}${init.port !== 22 ? `:${init.port}` : ""}`;
      setLabel(title);
      document.title = `${title} — Passman`;
      setState("running");

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 14,
        scrollback: 5000,
        theme: { background: "#0e0f10", foreground: "#ededed" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current!);
      fit.fit();
      term.focus();

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${proto}//${window.location.host}/api/ssh/ws?ticket=${encodeURIComponent(init.ticket)}`,
      );
      ws.binaryType = "arraybuffer";
      let ended = false;
      const enc = new TextEncoder();
      const line = (color: string, text: string) =>
        term.write(`\r\n${color}${text}${RESET}\r\n`);

      ws.onopen = () => {
        // Credentials leave this tab exactly once, in the first frame.
        ws.send(
          JSON.stringify({
            ...(init.password ? { password: init.password } : {}),
            ...(init.privateKey ? { private_key: init.privateKey } : {}),
            cols: term.cols,
            rows: term.rows,
          }),
        );
        delete init.password;
        delete init.privateKey;
      };

      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data !== "string") {
          term.write(new Uint8Array(e.data as ArrayBuffer));
          return;
        }
        let ev: ServerEvent;
        try {
          ev = JSON.parse(e.data) as ServerEvent;
        } catch {
          return;
        }
        switch (ev.t) {
          case "status":
            line(DIM, ev.m);
            break;
          case "hostkey":
            line(
              ev.new ? YELLOW : DIM,
              ev.new
                ? `First connection to this host — pinned host key ${ev.fp}`
                : `Host key verified ${ev.fp}`,
            );
            break;
          case "ready":
            term.write("\r\n");
            term.focus();
            break;
          case "exit":
            ended = true;
            line(GREEN, `Session closed${ev.code != null ? ` (exit ${ev.code})` : ""}.`);
            break;
          case "error":
            ended = true;
            line(RED, ev.m);
            break;
        }
      };

      ws.onclose = () => {
        if (!ended) line(RED, "Connection closed.");
        term.options.disableStdin = true;
        document.title = `[closed] ${title} — Passman`;
      };

      term.onData((d) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(d));
      });
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "resize", cols, rows }));
        }
      });
      const onWinResize = () => fit.fit();
      window.addEventListener("resize", onWinResize);

      return () => {
        window.removeEventListener("resize", onWinResize);
        ws.close();
        term.dispose();
      };
    }

    return () => {
      window.clearInterval(announceTimer);
      window.removeEventListener("message", onMessage);
      cleanup?.();
    };
  }, []);

  if (state === "orphan") {
    return (
      <main className="auth-container">
        <h1>Terminal</h1>
        <p className="auth-tagline">
          Open a shell from the vault: pick a credential, press Connect, then
          “Open shell in new tab”. For security the credential is handed over
          once and is not kept, so this page can't be reloaded.
        </p>
      </main>
    );
  }

  return (
    <div className="terminal-page">
      <div className="terminal-bar">
        <span className="terminal-title">{label || "Connecting…"}</span>
        <span className="terminal-hint">Closing this tab ends the session</span>
      </div>
      <div className="terminal-host" ref={containerRef} />
    </div>
  );
}
