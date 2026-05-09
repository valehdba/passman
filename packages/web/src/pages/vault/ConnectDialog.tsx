import { useEffect } from "react";

import {
  buildConnectCommand,
  buildJdbcUrl,
  buildRdpFile,
  buildSshUrl,
  copyPlain,
  copySensitive,
  downloadRdpFile,
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

  const target = [
    p.hostname,
    p.ip,
    p.port !== undefined ? `${p.hostname || p.ip || ""}:${p.port}` : "",
    p.username && (p.domain ? `${p.domain}\\${p.username}` : p.username),
  ]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(" · ");

  const jdbcUrl = supportsJdbc(protocol) ? buildJdbcUrl(p) : null;
  const sshUrl = buildSshUrl(p);
  const cmd = buildConnectCommand(p);
  const canRdp = !!buildRdpFile({ ...p, protocol: "rdp" });

  function done(action: string) {
    onUsed(item!.id);
    onToast(action);
    onClose();
  }

  async function handleJdbc() {
    if (!jdbcUrl) return;
    await copyPlain(jdbcUrl);
    if (p.password) {
      // Queue the password on the clipboard with auto-clear so the user can
      // paste it into the next field. The plain URL was just overwritten by
      // copySensitive's writeText, but that's the desired ordering — the
      // user pastes the URL first into DBeaver, then "Copy" again on the
      // next field grabs the password (we explicitly switched). For now we
      // give them the URL only and let them re-trigger via Copy buttons.
    }
    done(`JDBC URL copied · ${jdbcUrl}`);
  }

  async function handleSsh() {
    if (!sshUrl) return;
    if (p.password) await copySensitive(p.password);
    launchSshUrl(sshUrl);
    done("Launching SSH · password on clipboard, clears in 30 s");
  }

  async function handleCommand() {
    if (!cmd) return;
    await copyPlain(cmd);
    if (p.password) await copySensitive(p.password);
    done("Connect command copied · password on clipboard");
  }

  async function handleRdp() {
    const ok = downloadRdpFile({ ...p, protocol: "rdp" });
    if (!ok) {
      onToast("Add hostname + RDP port to enable RDP");
      return;
    }
    if (p.password) await copySensitive(p.password);
    done(".rdp downloaded · password on clipboard, clears in 30 s");
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
            hint="Ready-to-paste shell command · password also on clipboard"
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
                : "Add hostname or IP to enable"
            }
            hint="Downloads a pre-filled .rdp · password copied to clipboard, paste at the credential prompt"
            cta="Download .rdp"
            onClick={handleRdp}
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
