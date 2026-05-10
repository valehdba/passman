import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_OPTIONS,
  estimateEntropyBits,
  generatePassword,
  strengthLabel,
  type PasswordOptions,
} from "../../passwords/index.js";

interface Props {
  onPick: (password: string) => void;
  onClose: () => void;
}

const STORAGE_KEY = "passman.generator.opts.v1";

function loadStoredOptions(): PasswordOptions {
  if (typeof localStorage === "undefined") return { ...DEFAULT_OPTIONS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    const parsed = JSON.parse(raw) as Partial<PasswordOptions>;
    return { ...DEFAULT_OPTIONS, ...parsed };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function saveStoredOptions(opts: PasswordOptions): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    /* nothing more we can do */
  }
}

/**
 * Inline popover that lets the user dial in a password and pick "Use this".
 * Sits below the password field in the Add/Edit credential form.
 *
 * The user's last-used options persist to localStorage so they don't have
 * to re-tick the same boxes every time. The options shape is private to
 * this UI — the underlying generator works without persistence.
 */
export function PasswordGenerator({ onPick, onClose }: Props) {
  const [opts, setOpts] = useState<PasswordOptions>(loadStoredOptions);
  const [pw, setPw] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  // Generate one immediately on open + every time options change.
  useEffect(() => {
    try {
      setPw(generatePassword(opts));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPw("");
    }
    saveStoredOptions(opts);
  }, [opts]);

  const bits = useMemo(() => estimateEntropyBits(opts), [opts]);
  const strength = strengthLabel(bits);

  function regen() {
    try {
      setPw(generatePassword(opts));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="pw-gen">
      <div className="pw-gen-output">
        <code className="pw-gen-value" title={pw}>
          {pw || "—"}
        </code>
        <button
          type="button"
          className="icon-btn"
          onClick={regen}
          aria-label="Regenerate password"
          title="Regenerate"
        >
          ↻
        </button>
      </div>

      <div className="pw-gen-meter" data-strength={strength}>
        <div className="pw-gen-meter-bar">
          <div
            className="pw-gen-meter-fill"
            style={{ width: `${Math.min(100, (bits / 120) * 100)}%` }}
          />
        </div>
        <span className="pw-gen-meter-label">
          {Math.round(bits)} bits · {strength}
        </span>
      </div>

      <div className="pw-gen-row">
        <label className="pw-gen-length">
          Length: <strong>{opts.length}</strong>
          <input
            type="range"
            min={6}
            max={64}
            value={opts.length}
            onChange={(e) => setOpts({ ...opts, length: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="pw-gen-row pw-gen-checks">
        <label>
          <input
            type="checkbox"
            checked={opts.lowercase}
            onChange={(e) => setOpts({ ...opts, lowercase: e.target.checked })}
          />
          a–z
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.uppercase}
            onChange={(e) => setOpts({ ...opts, uppercase: e.target.checked })}
          />
          A–Z
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.digits}
            onChange={(e) => setOpts({ ...opts, digits: e.target.checked })}
          />
          0–9
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.symbols}
            onChange={(e) => setOpts({ ...opts, symbols: e.target.checked })}
          />
          {"!@#$%"}
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.avoidAmbiguous}
            onChange={(e) => setOpts({ ...opts, avoidAmbiguous: e.target.checked })}
          />
          No 0/O/1/l
        </label>
      </div>

      {err && <p className="error">{err}</p>}

      <div className="pw-gen-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (pw) onPick(pw);
          }}
          disabled={!pw}
        >
          Use this password
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
