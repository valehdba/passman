/**
 * Content script.
 *
 * Detects password fields on the current page and shows a small inline
 * picker the user clicks to fill. We never autofill silently — the user
 * must explicitly select an item, defending against autofill-trick attacks
 * where invisible fields harvest credentials.
 */
import type { Message, Response } from "./messages.js";

interface MatchItem {
  id: string;
  name: string;
  username: string;
}

const PICKER_ID = "passman-picker-7e2a";

async function send(msg: Message): Promise<Response> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp: Response) => {
      if (chrome.runtime.lastError) {
        resolve({ kind: "error", message: chrome.runtime.lastError.message ?? "no response" });
        return;
      }
      resolve(resp);
    });
  });
}

function findCredentialFields(): { user: HTMLInputElement | null; pass: HTMLInputElement } | null {
  const passwords = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]:not([disabled])'),
  ).filter((el) => el.offsetParent !== null);
  if (passwords.length === 0) return null;
  const pass = passwords[0]!;

  // Find a username field — typically the previous text/email input in DOM order.
  const all = Array.from(
    document.querySelectorAll<HTMLInputElement>("input"),
  );
  const idx = all.indexOf(pass);
  let user: HTMLInputElement | null = null;
  for (let i = idx - 1; i >= 0; i--) {
    const el = all[i]!;
    if (
      (el.type === "text" || el.type === "email" || el.type === "tel") &&
      el.offsetParent !== null
    ) {
      user = el;
      break;
    }
  }
  return { user, pass };
}

function removeExistingPicker(): void {
  document.getElementById(PICKER_ID)?.remove();
}

function renderPicker(
  anchor: HTMLElement,
  items: MatchItem[],
  onPick: (id: string) => void,
): void {
  removeExistingPicker();
  const rect = anchor.getBoundingClientRect();
  const div = document.createElement("div");
  div.id = PICKER_ID;
  Object.assign(div.style, {
    position: "absolute",
    top: `${window.scrollY + rect.bottom + 4}px`,
    left: `${window.scrollX + rect.left}px`,
    zIndex: "2147483647",
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: "4px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    minWidth: "200px",
    color: "#000",
  } satisfies Partial<CSSStyleDeclaration>);

  const title = document.createElement("div");
  title.textContent = "Passman";
  Object.assign(title.style, { padding: "6px 10px", fontWeight: "600", borderBottom: "1px solid #eee" });
  div.appendChild(title);

  for (const it of items) {
    const row = document.createElement("button");
    row.type = "button";
    row.textContent = `${it.name} — ${it.username || "(no username)"}`;
    Object.assign(row.style, {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "8px 10px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      color: "#000",
    });
    row.addEventListener("mouseenter", () => {
      row.style.background = "#f0f0f0";
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "transparent";
    });
    row.addEventListener("click", (e) => {
      e.preventDefault();
      onPick(it.id);
      removeExistingPicker();
    });
    div.appendChild(row);
  }

  document.body.appendChild(div);
}

function setReactCompatible(input: HTMLInputElement, value: string): void {
  // React tracks the input's "previous value"; setting .value bypasses that.
  // Use the native setter then dispatch input/change events.
  const proto = Object.getPrototypeOf(input);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function pickAndFill(item: MatchItem, fields: { user: HTMLInputElement | null; pass: HTMLInputElement }): Promise<void> {
  const resp = await send({ kind: "vault:reveal", itemId: item.id });
  if (resp.kind !== "credentials") {
    console.warn("[Passman] reveal failed:", resp);
    return;
  }
  if (fields.user && resp.username) setReactCompatible(fields.user, resp.username);
  setReactCompatible(fields.pass, resp.password);
}

async function offerAutofill(): Promise<void> {
  const fields = findCredentialFields();
  if (!fields) return;
  const resp = await send({ kind: "vault:matches", origin: window.location.origin });
  if (resp.kind !== "matches") {
    // Vault locked or error — don't surface anything.
    return;
  }
  if (resp.items.length === 0) return;
  const anchor = fields.user ?? fields.pass;
  renderPicker(anchor, resp.items, (id) => {
    const picked = resp.items.find((i) => i.id === id);
    if (picked) void pickAndFill(picked, fields);
  });
}

// Trigger when the user focuses a credential field — much better signal than
// firing on page load (which would create flicker / wasted unlocks).
document.addEventListener(
  "focusin",
  (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && (t.type === "password" || t.type === "email" || t.type === "text")) {
      void offerAutofill();
    }
  },
  true,
);

document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) return;
  if (!e.target.closest(`#${PICKER_ID}`)) removeExistingPicker();
});
