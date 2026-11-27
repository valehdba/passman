import { useEffect, useState } from "react";

import { api } from "../../api/client.js";
import { useSession } from "../../stores/session.js";
import { TERMINAL_INIT, TERMINAL_READY } from "../TerminalPage.js";

import {
  buildConnectCommand,
  buildJdbcUrl,
  buildSshKeyCommand,
  buildSshUrl,
  buildTargetSubtitle,
  clipboardClearLabel,
  canBuildRdp,
  copyPlain,
  copySensitive,
  downloadRdpFile,
  downloadSshKey,
  effectiveProtocol,
  engineCode,
  launchSshUrl,
  protocolLabel,
  supportsJdbc,
} from "../../connect/index.js";
import { IconCopy, IconDb, IconLock, IconRdp, IconTerminal } from "./icons.js";
import type { DecryptedItem } from "./types.js";

interface Props {
  item: DecryptedItem | null;
  onClose: () => void;
  onUsed: (id: string) => void;
  onToast: (msg: string) => void;
}

export function ConnectDialog({ item, onClose, onUsed, onToast }: Props) {
  const accessToken = useSession((s) => s.accessToken);
  // Whether the server's SSH gateway is enabled (SSH_ALLOWED_HOSTS non-empty).
  const [shellEnabled, setShellEnabled] = useState(false);
  useEffect(() => {
    if (!item || !accessToken) return;
    let live = true;
    api
      .sshConfig(accessToken)
      .then((c) => live && setShellEnabled(c.enabled))
      .catch(() => live && setShellEnabled(false));
    return () => {
      live = false;
    };
  }, [item, accessToken]);

  // Close on Escape — common modal expectation.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) return null;
  const p = item.plaintext;
  const protocol = effectiveProtocol(p);
  const protoKey = protocol ?? "unknown";
  const code = engineCode(protocol);
  const proto = protocolLabel(protocol);

  const target = buildTargetSubtitle(p);

  const jdbcUrl = supportsJdbc(protocol) ? buildJdbcUrl(p) : null;
  const sshUrl = buildSshUrl(p);
  const cmd = buildConnectCommand(p);
  const sshKeyCmd = buildSshKeyCommand(p);
  const hasKey = !!p.privateKey;
  // RDP is offered only when the credential is itself an RDP entry. For a
  // Postgres credential on port 5432 we'd otherwise generate an .rdp file
  // pointing at port 5432, which doesn't run RDP — that's a bug, not a
  // feature.
  const canRdp = canBuildRdp(p);

  function done(action: string) {
    onUsed(item!.id);
    onToast(action);
    onClose();
  }

  async function handleJdbc() {
    if (!jdbcUrl) return;
    await copyPlain(jdbcUrl);
    done("JDBC URL copied · use the row's Copy button for the password");
  }

  /**
   * Open the in-browser shell in a new tab. window.open must run synchronously
   * inside the click (popup blockers), so the tab opens first and the ticket +
   * credential are handed over via postMessage once it announces itself.
   */
  async function handleShell() {
    if (!accessToken) return;
    const host = p.hostname || p.ip;
    if (!host || !p.username || (!p.password && !p.privateKey)) return;
    const opened = window.open("/terminal", "_blank");
    if (!opened) {
      onToast("Popup blocked — allow popups for this site to open the shell");
      return;
    }
    const tab: Window = opened;
    // Listen for the tab's "ready" BEFORE doing any async work: the tab can load
    // (and announce itself) before the ticket request returns.
    let stopListening = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        stopListening();
        reject(new Error("Terminal tab did not respond"));
      }, 15_000);
      function onMsg(e: MessageEvent) {
        if (
          e.origin === window.location.origin &&
          e.source === tab &&
          (e.data as { type?: string } | null)?.type === TERMINAL_READY
        ) {
          stopListening();
          resolve();
        }
      }
      stopListening = () => {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMsg);
      };
      window.addEventListener("message", onMsg);
    });
    ready.catch(() => {}); // avoid an unhandled rejection if the ticket step fails first

    try {
      const port = p.port ?? 22;
      const [{ ticket }] = await Promise.all([
        api.sshTicket(accessToken, { host, port, username: p.username }),
        ready,
      ]);
      tab.postMessage(
        {
          type: TERMINAL_INIT,
          ticket,
          host,
          port,
          username: p.username,
          ...(p.password ? { password: p.password } : {}),
          ...(p.privateKey ? { privateKey: p.privateKey } : {}),
        },
        window.location.origin,
      );
      done("Shell opened in a new tab");
    } catch (e) {
      stopListening();
      tab.close();
      onToast(e instanceof Error ? e.message : "Could not open the shell");
    }
  }

  async function handleSsh() {
    if (!sshUrl) return;
    // Copy the password first (so it's on the clipboard when the SSH client
    // prompts for it), then launch the URL handler. If we launched first,
    // the synthetic anchor click could race with the writeText call in
    // browsers that suspend the page on protocol-handler invocation.
    if (p.password) await copySensitive(p.password);
    launchSshUrl(sshUrl);
    done(`Launching SSH · password on clipboard, ${clipboardClearLabel()}`);
  }

  async function handleCommand() {
    if (!cmd) return;
    // Copy the command alone. We deliberately do NOT also copy the password
    // here — the second writeText would overwrite the command, leaving the
    // user's clipboard holding the password they expected to paste a command
    // from. The row's per-row Copy button is the password path.
    await copyPlain(cmd);
    done("Connect command copied · use the row's Copy button for the password");
  }

  async function handleRdp() {
    if (!canRdp) return;
    const ok = downloadRdpFile(p);
    if (!ok) {
      onToast("Add hostname or IP to this credential");
      return;
    }
    if (p.password) await copySensitive(p.password);
    done(`.rdp downloaded · password on clipboard, ${clipboardClearLabel()}`);
  }

  async function handleSshKey() {
    if (!hasKey || !sshKeyCmd) return;
    const ok = downloadSshKey(p);
    if (!ok) {
      onToast("No private key set on this credential");
      return;
    }
    // Push the matching `ssh -i ...` command on the clipboard so the user
    // can paste it after they've moved the .pem into ~/.ssh/passman/.
    await copyPlain(sshKeyCmd);
    done("Key downloaded · ssh -i command copied — move .pem to ~/.ssh/passman/ then paste");
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className={`engine-tile e-${protoKey}`}>{code}</span>
          <div>
            <h2 id="connect-title">Connect to {p.name}</h2>
            <div className="target">{target || proto}</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <Option
            disabled={!jdbcUrl}
            icon={<IconDb />}
            title="Copy JDBC URL"
            meta={jdbcUrl ?? "No JDBC driver for this protocol"}
            hint="For DBeaver, DataGrip, DBVisualizer · paste the password into the connection's password field"
            cta={jdbcUrl ? "Copy URL" : "Unavailable"}
            onClick={handleJdbc}
          />

          {shellEnabled && protocol === "ssh" && (
            <Option
              disabled={!(p.hostname || p.ip) || !p.username || (!p.password && !p.privateKey)}
              icon={<IconTerminal />}
              title="Open shell in new tab"
              meta={
                p.hostname || p.ip
                  ? `${p.username || "user"}@${p.hostname || p.ip}:${p.port ?? 22}`
                  : "Add hostname or IP to enable"
              }
              hint="Built-in terminal · the server connects on your behalf using the decrypted credential for this session only"
              cta="Open shell"
              onClick={() => void handleShell()}
            />
          )}

          <Option
            disabled={!sshUrl}
            icon={<IconTerminal />}
            title="Open SSH session"
            meta={sshUrl ?? "Add hostname or IP to enable"}
            hint="Launches your default terminal via the ssh:// handler · password copied to clipboard"
            cta="Connect"
            onClick={handleSsh}
          />

          <Option
            disabled={!cmd}
            icon={<IconCopy />}
            title="Copy connect command"
            meta={cmd ?? "No canonical command for this protocol"}
            hint="Ready-to-paste shell command · use the row's Copy button for the password"
            cta="Copy"
            onClick={handleCommand}
          />

          <Option
            disabled={!canRdp}
            icon={<IconRdp />}
            title="Open RDP session"
            meta={
              canRdp
                ? `${p.hostname || p.ip}:${p.port ?? 3389}`
                : protocol === "rdp"
                  ? "Add hostname or IP to enable"
                  : "Set protocol to RDP on this credential to enable"
            }
            hint="Downloads a pre-filled .rdp · password copied to clipboard, paste at the credential prompt"
            cta="Download .rdp"
            onClick={handleRdp}
          />

          <Option
            disabled={!hasKey || !sshKeyCmd}
            icon={<IconLock />}
            title={hasKey ? "Connect with SSH key" : "Use SSH private key"}
            meta={
              hasKey
                ? sshKeyCmd ?? "Add hostname to enable"
                : "No key attached — add one in Edit"
            }
            hint={
              hasKey
                ? "Downloads the .pem · ssh -i command copied to clipboard"
                : "Paste a PEM-encoded private key in the credential's Edit screen to enable this"
            }
            cta={hasKey ? "Download .pem" : "Set up"}
            onClick={handleSshKey}
          />
        </div>

        <div className="modal-foot">
          <span className="lock-ico"><IconLock /></span>
          <span>Decrypted in your browser. Server never sees the password.</span>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

interface OptionProps {
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  meta: string;
  hint: string;
  cta: string;
  onClick: () => void;
}

function Option({ disabled, icon, title, meta, hint, cta, onClick }: OptionProps) {
  return (
    <button
      type="button"
      className="conn-option"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="ico">{icon}</span>
      <span className="label">
        <div className="title">{title}</div>
        <div className="meta">{meta}</div>
        <div className="hint">{hint}</div>
      </span>
      <span className="go">{cta}</span>
    </button>
  );
}
