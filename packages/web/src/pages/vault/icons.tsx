/**
 * Inline SVG icons. Small, no dependency on a sprite system or icon library.
 * All icons inherit `currentColor` so the parent's CSS controls colour.
 */

const baseProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconSearch(props: { size?: number }) {
  return (
    <svg {...baseProps} width={props.size ?? 14} height={props.size ?? 14}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function IconLock(props: { size?: number }) {
  return (
    <svg {...baseProps} width={props.size ?? 13} height={props.size ?? 13}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function IconTerminal() {
  return (
    <svg {...baseProps} width={16} height={16}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  );
}

export function IconRdp() {
  return (
    <svg {...baseProps} width={16} height={16}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 4 3-4 3M12 15h6" />
    </svg>
  );
}

export function IconDb() {
  return (
    <svg {...baseProps} width={16} height={16}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
    </svg>
  );
}

export function IconCopy() {
  return (
    <svg {...baseProps} width={16} height={16}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
