import { useMemo, useState } from "react";

import { useBranding } from "../../branding/index.js";
import { effectiveProtocol, protocolLabel } from "../../connect/index.js";
import { IconSearch } from "./icons.js";
import type { DecryptedItem, GroupKey } from "./types.js";

/**
 * Selected scope = which group filter the user has clicked.
 * `null` means "no group filter active" (showing all items, possibly filtered
 * only by the search box).
 */
export interface SidebarScope {
  groupKey: GroupKey;
  /** The chosen value within that group (e.g. "10.0.0.42" or "5432"). */
  value: string;
}

interface Props {
  email: string | null;
  items: DecryptedItem[];
  scope: SidebarScope | null;
  onScopeChange: (scope: SidebarScope | null) => void;
  onExport: () => void;
}

export function Sidebar({ email, items, scope, onScopeChange, onExport }: Props) {
  const [filter, setFilter] = useState("");
  const branding = useBranding();

  const ipBuckets = useMemo(() => bucket(items, "ip"), [items]);
  const portBuckets = useMemo(() => bucket(items, "port"), [items]);
  const userBuckets = useMemo(() => bucket(items, "username"), [items]);
  const protoBuckets = useMemo(() => bucketProtocol(items), [items]);

  const matchesFilter = (label: string) =>
    !filter || label.toLowerCase().includes(filter.toLowerCase());

  return (
    <aside className="vault-side">
      <div className="brand">
        {branding.logoUrl ? (
          <img
            className="brand-logo"
            src={branding.logoUrl}
            alt={`${branding.appName} logo`}
            width={22}
            height={22}
          />
        ) : (
          <div className="brand-mark" />
        )}{" "}
        {branding.appName}
      </div>

      <div className="side-search">
        <IconSearch size={13} />
        <input
          placeholder="Filter views…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div>
        <div className="side-section">Vault</div>
        <div className="side-list">
          <button
            type="button"
            className={`side-item ${scope === null ? "active" : ""}`}
            onClick={() => onScopeChange(null)}
          >
            <span className="left">All credentials</span>
            <span className="count">{items.length}</span>
          </button>
        </div>
      </div>

      {protoBuckets.length > 0 && (
        <Section
          title="Group · protocol"
          buckets={protoBuckets}
          render={(label) => label}
          isActive={(value) =>
            scope?.groupKey === "protocol" && scope.value === value
          }
          onPick={(value) => onScopeChange({ groupKey: "protocol", value })}
          matchesFilter={matchesFilter}
        />
      )}

      {ipBuckets.length > 0 && (
        <Section
          title="Group · IP address"
          buckets={ipBuckets}
          render={(label) => (
            <span className="left">
              <span className="ip-dot" />
              {label}
            </span>
          )}
          isActive={(value) => scope?.groupKey === "ip" && scope.value === value}
          onPick={(value) => onScopeChange({ groupKey: "ip", value })}
          matchesFilter={matchesFilter}
        />
      )}

      {portBuckets.length > 0 && (
        <Section
          title="Group · port"
          buckets={portBuckets}
          render={(label) => label}
          isActive={(value) => scope?.groupKey === "port" && scope.value === value}
          onPick={(value) => onScopeChange({ groupKey: "port", value })}
          matchesFilter={matchesFilter}
        />
      )}

      {userBuckets.length > 0 && (
        <Section
          title="Group · user"
          buckets={userBuckets}
          render={(label) => label}
          isActive={(value) =>
            scope?.groupKey === "username" && scope.value === value
          }
          onPick={(value) => onScopeChange({ groupKey: "username", value })}
          matchesFilter={matchesFilter}
        />
      )}

      <div className="user-card">
        <div className="avatar">
          {(email ?? "??").slice(0, 2).toUpperCase()}
        </div>
        <div className="who">
          <div className="email" title={email ?? ""}>
            {email ?? "Unknown"}
          </div>
          <small>
            <button
              type="button"
              className="user-card-action"
              onClick={onExport}
              title="Download an encrypted JSON backup of your whole vault"
            >
              Export backup
            </button>
            {branding.supportEmail && (
              <>
                {" · "}
                <a href={`mailto:${branding.supportEmail}`}>Support</a>
              </>
            )}
          </small>
        </div>
      </div>

      {branding.footerText && (
        <div className="brand-footer" title={branding.footerText}>
          {branding.footerText}
        </div>
      )}
    </aside>
  );
}

interface Bucket {
  value: string;
  count: number;
}

function bucket(
  items: DecryptedItem[],
  key: "ip" | "port" | "username",
): Bucket[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const raw = it.plaintext[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const v = String(raw);
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([value, count]) => ({ value, count }));
}

function bucketProtocol(items: DecryptedItem[]): Bucket[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const proto = effectiveProtocol(it.plaintext);
    if (!proto) continue;
    const label = protocolLabel(proto);
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, count]) => ({ value, count }));
}

interface SectionProps {
  title: string;
  buckets: Bucket[];
  render: (label: string) => React.ReactNode;
  isActive: (value: string) => boolean;
  onPick: (value: string) => void;
  matchesFilter: (label: string) => boolean;
}

function Section({
  title,
  buckets,
  render,
  isActive,
  onPick,
  matchesFilter,
}: SectionProps) {
  const visible = buckets.filter((b) => matchesFilter(b.value));
  if (visible.length === 0) return null;
  return (
    <div>
      <div className="side-section">{title}</div>
      <div className="side-list">
        {visible.map((b) => (
          <button
            type="button"
            key={`${title}:${b.value}`}
            className={`side-item ${isActive(b.value) ? "active" : ""}`}
            onClick={() => onPick(b.value)}
          >
            {render(b.value)}
            <span className="count">{b.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
