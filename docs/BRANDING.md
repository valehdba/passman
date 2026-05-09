# Branding & white-label customisation

Passman ships unbranded by default. Operators who want to deploy it
under their own name and colours edit a single file —
`packages/web/public/branding.json` — without rebuilding the web bundle.

The same web image can therefore serve any number of customers; mount a
different `branding.json` per deployment via Kubernetes ConfigMap, a
Docker bind mount, or a templated CI step.

## What you can customise

| Field            | Type   | Effect                                                                     |
| ---------------- | ------ | -------------------------------------------------------------------------- |
| `appName`        | string | Shown in the sidebar, browser tab title, and login/register heroes.        |
| `tagline`        | string | One-liner displayed under "Unlock your vault" / "Create your vault".       |
| `logoUrl`        | string | Same-origin path / `https://` URL / `data:` URL. Empty = default mark.     |
| `brandColor`     | hex    | Primary accent (#RRGGBB, #RGB, or #RRGGBBAA). Drives the Connect button, focus rings, every accent surface. |
| `brandColorDark` | hex    | Hover / gradient stop — defaults to a darkened brandColor.                 |
| `supportEmail`   | string | Adds a `Support` mailto link in the user card. Empty hides it.             |
| `footerText`     | string | Small footer line in the sidebar (e.g. "© Acme Corp · Internal use only").  |

Every field is optional — anything you leave out falls through to the
defaults baked into `DEFAULT_BRANDING` in
[`packages/web/src/branding/defaults.ts`](../packages/web/src/branding/defaults.ts).

## Quick start (60 seconds)

1. **Replace the logo** — drop your SVG (or PNG, but SVG renders crisper) into
   `packages/web/public/branding/logo.svg`. There's an example at
   [`packages/web/public/branding/logo.example.svg`](../packages/web/public/branding/logo.example.svg)
   you can copy as a starting point.

2. **Edit `packages/web/public/branding.json`:**

   ```jsonc
   {
     "appName": "Acme Vault",
     "tagline": "Your team's credentials, safely off the cloud.",
     "logoUrl": "/branding/logo.svg",
     "brandColor": "#0a66c2",
     "brandColorDark": "#084d92",
     "supportEmail": "vault-support@acme.example",
     "footerText": "© Acme Corp · Internal use only"
   }
   ```

   A reference is committed at
   [`packages/web/public/branding.example.json`](../packages/web/public/branding.example.json).

3. **Reload the page.** Vite serves both files from `/`, the React app
   fetches `/branding.json` on boot, and the document re-themes
   immediately. No build step needed in dev.

4. **For production**, the same files are copied to `dist/` by `vite
   build`. To swap branding without rebuilding, mount your own
   `branding.json` and `branding/logo.svg` over the served `dist/`
   directory at deploy time.

## CSP & security

The default index.html has a strict Content-Security-Policy. Logo URLs
must satisfy `img-src 'self' data:` — i.e.:

- **Same-origin paths** (`/branding/logo.svg`) — works out of the box.
- **`data:` URLs** — also allowed; useful for inlining a small SVG
  directly in `branding.json` if you can't serve a separate file.
- **Cross-origin URLs (`https://cdn.example/...`)** — blocked by the
  default CSP. Either widen `img-src` in
  [`packages/web/index.html`](../packages/web/index.html) or proxy the
  asset under your own origin.

The branding loader rejects unsafe schemes (`javascript:`, `file://`,
`ftp://` …) silently and falls back to the default mark — a safety net
for the case where `branding.json` is ever filled by user input rather
than an operator.

## What is NOT customised (and why)

- **Encryption defaults** — Argon2id parameters, AES-256-GCM, the
  zero-knowledge protocol. These are security-critical; changing them
  belongs in the server's config, not a customer-facing brand file.
- **Per-user themes** — `branding.json` is instance-wide. A customer
  who needs per-user theming should layer that on top of this feature
  (e.g. let a user pick from a list the operator has approved).
- **Dark / light mode toggle** — Passman is dark-first by design. The
  brand colour is the only colour token an operator overrides today.
- **Extension popup** — the Manifest V3 popup is a separate context
  with its own bundle. Branding the extension is tracked as a
  follow-up; for now the popup keeps the default mark.

## Testing your override locally

```bash
# in repo root
npm run dev --workspace=@passman/web
# open http://localhost:5173 — your branding.json is served at /branding.json
```

The login page should now show your logo + appName + tagline above the
form, and the brand colour should drive the Unlock button + every
accent in the vault.

If the change doesn't appear, open DevTools → Network and confirm
`/branding.json` returns your override. A failed fetch (404, network
error, malformed JSON) silently falls back to defaults.

## How it works

The branding system is implemented in
[`packages/web/src/branding/`](../packages/web/src/branding/):

- `types.ts` — the `Branding` shape and partial `BrandingOverride`
- `defaults.ts` — frozen `DEFAULT_BRANDING`
- `load.ts` — fetch + sanitise + merge, plus `applyBranding()` that
  writes `--brand` / `--brand-2` / `--brand-soft` / `--brand-line` CSS
  variables on `:root` so any already-painted accent re-themes
- `BrandingProvider.tsx` — React context provider that fetches once on
  mount; components read it with `useBranding()`

The provider does NOT block render — the first paint uses defaults and
the customer's branding takes effect on the second render. That keeps
the app booting under any failure mode.
