# Passman — User guide

This guide walks through every screen of the Passman web vault and the
companion Chrome extension, from creating a vault through connecting to
a database with one click.

> **Zero-knowledge reminder.** The screens below all run client-side. The
> server only ever sees ciphertext + your KDF parameters. Your master
> password and decryption key never leave the browser.

The screenshots are reproducible from `docs/preview/*.html` — see
[Reproducing the screenshots](#reproducing-the-screenshots) at the end.

---

## 1. Create your vault

Open `http://localhost:5173` and click **Create a vault** on the login
page. The registration screen looks like this:

![Register screen](img/register.png)

Fields:

- **Email** — used for login + future recovery hints; never stored
  alongside your plaintext password.
- **Master password** — minimum 12 characters. **Write it down.** Passman
  has no recovery channel; if you forget it, the vault is permanently
  unreadable.
- **Confirm password** — typo guard.

When you submit, the browser:

1. Generates a random 16-byte KDF salt and a random 256-bit symmetric
   vault key.
2. Derives a master key from your password via Argon2id.
3. Encrypts the symmetric key with the master key (AES-256-GCM).
4. Sends only the ciphertext + salt + KDF parameters to the server.

You're then redirected to the login screen.

---

## 2. Unlock your vault

![Login screen](img/login.png)

Enter the same email and master password. The browser:

1. Asks the server for your KDF parameters (the server returns plausible
   decoy parameters for unknown emails, so attackers can't enumerate).
2. Re-derives the master key locally.
3. Derives a one-way **auth key** from the master key + password and
   sends only that to the server. The server has no way to reverse it
   into your password.
4. On a successful login, decrypts the symmetric key locally.

If decryption fails (wrong password) you'll see *"Vault decryption
failed."*; if the server rejects the auth key you'll see *"Invalid email
or password."*

---

## 3. The vault dashboard

After unlocking you land on the vault dashboard:

![Vault dashboard with sidebar groupings, engine-coloured rows, env tags, and per-row Connect button](img/vault.png)

The screen has three regions.

### 3a. Sidebar (left)

The sidebar exposes how you actually work:

- **Filter views…** — filter the sidebar items themselves (handy when
  you have hundreds of hosts).
- **All credentials** — the unfiltered view.
- **Group · protocol** — every protocol present in your vault becomes a
  one-click filter (`PSQL`, `ORACLE`, `MYSQL`, `REDIS`, `MONGO`, `SSH`,
  `RDP`, …). Click `PSQL` and the grid shows only Postgres entries.
- **Group · IP address** — every distinct IP, with a count.
- **Group · port** — every distinct port (`5432`, `3306`, `1521`, …).
- **User card** — your email + an "unlocked" indicator.

Sidebar clicks act as **scope filters** that compose with the search
box. If you click `10.0.0.42` and then type `replica`, you'll see only
items that match *both*.

The breadcrumb (`Vault / IP : 10.0.0.42`) and a **Clear group** button
appear once a sidebar scope is active.

### 3b. Main grid (right)

Each row carries:

| Column        | What it holds                                                            |
| ------------- | ------------------------------------------------------------------------ |
| Checkbox      | Multi-select for bulk actions.                                           |
| **Name**      | Friendly label + an **engine tile** (PG / OR / MY / RD / MG / SSH / RDP) |
|               | and a connection-string subtitle (`postgres://db-prod-01:5432/app`).     |
| **Hostname**  | DNS name. Click to copy.                                                 |
| **IP**        | IPv4/IPv6 with tabular numerals so digits align.                         |
| **User**      | Account name (e.g. `postgres`, `EXAMPLE\sys`).                           |
| **Password**  | Masked. **Reveal** / **Copy** appear on hover; clipboard auto-clears.    |
| **Port**      | Right-aligned tabular number.                                            |
| **Protocol**  | Mono pill — colour-coded so you can scan a long list and spot SSH       |
|               | bastions among the database creds.                                       |
| **Env**       | Free-form environment tag (`prod`, `staging`, `dev`, `cache`).           |
| **Last used** | Relative time (`2m ago`, `yesterday`, `5d ago`). Stored locally; never   |
|               | sent to the server.                                                      |
| **Connect**   | Always-visible primary action — opens the Connect dialog ([§4](#4-connect)). |
| **✕**         | Per-row delete with confirmation.                                        |

#### Search and selection

- **Search** filters in real time across name, hostname, IP, user, port,
  protocol, URL, notes, database, service name, domain, and environment.
  Entirely in-browser — your query never reaches the server.
  Press **⌘K** / **Ctrl+K** to focus the search at any time.
- **Select** rows via the per-row checkbox or the header checkbox
  (selects all *currently visible* rows). A green selection toolbar
  appears with a `Delete` action; **Clear selection** dismisses it.

### 3c. Header bar

- **Zero-knowledge** pill — at-a-glance reminder of the trust model.
- **Lock** — wipes the in-memory symmetric key, revokes the refresh
  token server-side, returns to the login screen.

---

## 4. Connect

The headline feature: jump from a saved credential to a working
connection in one click. Click **Connect →** on any row:

![Connect dialog with JDBC URL, SSH, copy-command, and RDP options](img/vault-connect.png)

The dialog adapts per credential. For a Postgres entry it offers four
actions, ranked by how a DBA actually works:

### 4a. Copy JDBC URL

Builds a JDBC connection string suitable for **DBeaver, IntelliJ
DataGrip, DBVisualizer, Squirrel SQL** and most enterprise ETL tools:

| Engine     | Format                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| PostgreSQL | `jdbc:postgresql://host:port/database`                                  |
| MySQL      | `jdbc:mysql://host:port/database`                                       |
| MariaDB    | `jdbc:mariadb://host:port/database`                                     |
| Oracle     | `jdbc:oracle:thin:@//host:port/SERVICE_NAME` (or `host:port:SID`)       |
| SQL Server | `jdbc:sqlserver://host:port;databaseName=db`                            |
| MongoDB    | `jdbc:mongodb://host:port/database`                                     |

Passman copies the URL **without the password** — almost every JDBC tool
wants it in a separate field, and embedding it in the URL leaks the
password into driver connection logs and (on some platforms) into `ps`
output. The password is queued on the clipboard separately, ready for
the next paste, with a 30-second auto-clear.

### 4b. Open SSH session

Triggers the OS's `ssh://` protocol handler, which routes to your
default terminal: iTerm/Terminal on macOS, Windows Terminal, Konsole on
Linux. The URL is `ssh://user@host[:port]` — **never** with a password
embedded (SSH clients reject `:pw@` URLs). The password is copied to
the clipboard with the same 30-second auto-clear; paste it at the
`Password:` prompt.

### 4c. Copy connect command

Puts a ready-to-paste shell command on the clipboard:

| Protocol     | Command                                                              |
| ------------ | -------------------------------------------------------------------- |
| PostgreSQL   | `psql 'postgres://user@host:port/database'`                          |
| MySQL        | `mysql -h host -u user -P port -p database`                          |
| MariaDB      | `mariadb -h host -u user -P port -p database`                        |
| Oracle       | `sqlplus 'user/****@//host:port/SERVICE_NAME'`                       |
| SQL Server   | `sqlcmd -S host,port -U user -P "$PASSWORD" -d database`             |
| Redis        | `redis-cli -h host -p port [--user u] -a "$PASSWORD"`                |
| Mongo        | `mongosh 'mongodb://user:****@host:port/database'`                   |
| SSH          | `ssh user@host -p port` (omits `-p` for the default port 22)         |

The placeholder is `****` for tools that prompt for the password
inline, or `$PASSWORD` where the user is expected to set the env var.

### 4d. Open RDP session

Generates a Windows-format `.rdp` file pre-filled with the hostname,
port, and (when set) the AD domain + username. The file downloads
through the browser; opening it hands off to:

- **Windows** — the built-in `mstsc.exe`.
- **macOS** — Microsoft Remote Desktop (App Store).
- **Linux** — Remmina or FreeRDP via the system MIME handler.

Like the other actions, the password is on the clipboard for 30
seconds; paste it at the credential prompt the RDP client shows on
first connect.

> ⚠️ **Why isn't the password embedded in the .rdp file?** The format
> only accepts a DPAPI-encrypted blob (Windows) or the OS keychain
> (macOS / Linux), neither of which a browser can produce. Clipboard
> auto-clear is the practical compromise.

### 4e. What disabled options mean

The dialog greys out actions that don't apply to a credential:

- **Copy JDBC URL** is disabled for SSH, RDP, Redis, and HTTPS entries.
- **Open SSH session** is disabled if the entry has no host.
- **Open RDP session** is disabled if there's no host.
- **Copy connect command** is disabled for RDP and HTTPS (no canonical
  CLI).

---

## 5. Add a new credential

Click **+ New credential** in the top-right:

![Add credential form with the password generator open and the SSH private-key textarea visible](img/vault-add.png)

The form is **protocol-aware**:

- Pick **Protocol** first; the form auto-fills the default port
  (`5432` for PostgreSQL, `22` for SSH, `3389` for RDP, …).
- For database protocols, a **Database** field appears (and a
  **Service name** field for Oracle).
- For RDP, a **Windows AD domain** field appears so the resulting `.rdp`
  file uses `DOMAIN\user` correctly.
- **Environment** is free-form (`prod`, `staging`, `dev`, `cache`, …) —
  the colour of the env tag in the grid is inferred from the prefix.

Empty fields are stripped before encryption, so the ciphertext stays
small and forward-compatible.

### 5a. Store on this device only

For credentials you don't want stored remotely **even encrypted**, the
form has a **Store on this device only** toggle below the URL field.
When ticked:

- The encrypted ciphertext is written to **IndexedDB** in this browser
  (using the same vault key, so locking the vault still locks the local
  items).
- Nothing about the credential — not even the ciphertext — touches
  the server.
- Items appear in the grid with a green **DEVICE** badge next to the
  name, so you can tell at a glance which credentials are local-only.

> ⚠️ **The trade-offs are real.** A local-only credential:
>
> - Does **not sync** to other devices or browsers.
> - Is **wiped** if you clear site data, "Reset to defaults", or the OS
>   user profile is deleted.
> - Has **no off-device backup** — if this disk dies, the credential
>   dies with it.
>
> Use device-only storage for items where the security benefit
> ("never on a server, even encrypted") outweighs the convenience cost
> ("only on this machine"). Most credentials should stay on the
> server-default for the sync + backup guarantees.

The toggle defaults to off, so existing zero-knowledge guarantees apply
to everyone who doesn't opt in.

### 5b. Generate a strong password

Click **Generate** next to the Password field to open the inline generator:

- **Length** slider (6–64). Default 20.
- Toggles for `a–z`, `A–Z`, `0–9`, symbols, and *No 0/O/1/l* (drops
  visually-confusable characters — useful for passwords you'll read aloud).
- Live **strength meter** showing entropy bits and a label
  (`weak` / `fair` / `strong` / `excellent`) — backed by Shannon entropy
  (length × log₂(alphabet)).
- **Use this password** stamps the value into the Password field; **↻**
  re-rolls without closing the popover.

The CSPRNG is the browser's `crypto.getRandomValues`. Rejection sampling
ensures every char in the alphabet has equal probability — `% length`
would skew toward the start of the alphabet for non-power-of-two charsets.

Your last-used options persist to localStorage so you don't re-tick the
same boxes every time.

### 5c. Import from another vault

Click **↥ Import** in the page header to open the import dialog. v1
supports **Bitwarden CSV** (the most common export format).

In Bitwarden: **Tools → Export vault → File format CSV**. The export
contains plaintext passwords — keep the file on this device, import it
in Passman, and delete it.

The dialog parses the file, shows you a preview of the importable rows
plus any rows it skipped (with reasons), and lets you confirm. There's
also a **Store all imported items on this device only** toggle if you
want the whole batch local-only.

What gets mapped: `name`, `login_username`, `login_password`,
`login_uri`, `notes`, `login_totp`. Folders and unknown columns are
silently dropped. Non-login items (notes, cards, identities) are
skipped — Passman only stores logins today.

### 5d. SSH private-key field

For SSH-protocol credentials, the form grows an **SSH private key
(PEM)** textarea below the URL field. Paste any of:

- `-----BEGIN OPENSSH PRIVATE KEY-----`
- `-----BEGIN RSA PRIVATE KEY-----`
- `-----BEGIN EC PRIVATE KEY-----`
- `-----BEGIN PRIVATE KEY-----`

The key is encrypted with the same vault key as the password — the
server never sees its contents. Once attached, the Connect dialog's
**Connect with SSH key** option becomes active: it downloads the key
as `<name>.pem` and copies a matching command to the clipboard:

```
ssh -i ~/.ssh/passman/<name>.pem user@host [-p port]
```

Move the downloaded `.pem` into `~/.ssh/passman/` (chmod `600`), paste
the command, and connect.

### 5e. Edit an existing credential

Hover any row → click the **✎** icon next to the delete button. The
form opens in Edit mode with all current fields pre-filled. The
storage-location toggle is hidden (you can't move items between stores
from the form — that's a separate operation we deliberately defer).
Click **Save changes** to re-encrypt and persist.

For local-only items, the update writes a new IndexedDB record. For
server items, it issues `PATCH /api/vault/items/:id`.

### 5f. Export your vault

Click **Export backup** in the user card at the bottom of the sidebar.
Passman builds a JSON file containing every encrypted blob (server +
local) plus metadata, then downloads it as
`passman-<vault>-<YYYYMMDD>.json`. The file is unreadable without your
master password — the vault key never leaves the browser.

Use this for: disaster-recovery snapshots, migration between
self-hosted instances, before clearing site data.

The file shape is intentionally stable (`{ format, version, vault,
items: [...] }`) so a future Restore flow can consume it without a
schema bump.

### 5g. Two-factor authentication (TOTP)

Open the **Settings** link in the sidebar's user card. With 2FA off,
the Security section shows a single "Set up 2FA" call to action:

![Settings page with 2FA disabled](img/settings-2fa-off.png)

Click **Set up 2FA** to start the three-step setup flow:

1. **Scan the QR** with your authenticator (Google Authenticator,
   1Password, Authy, Microsoft Authenticator, …). If your phone can't
   reach the screen, expand "Can't scan? Type this manually" and copy
   the base32 secret directly into the app.

   ![2FA setup — scan QR step](img/settings-2fa-setup-qr.png)

2. **Confirm the first code.** Type the 6-digit code your authenticator
   shows. Passman verifies against the stored secret and only then
   flips the `totp_enabled` flag — if you abandon the flow before this
   step your account stays at single-factor.
3. **Save your recovery codes.** Ten single-use codes are shown
   *exactly once*. Each lets you log in if you lose your phone. Copy
   them, download the `.txt`, or write them down — Passman keeps only
   Argon2id hashes server-side, so this list cannot be retrieved later.

   ![2FA setup — save recovery codes step](img/settings-2fa-setup-recovery.png)

Once enabled, the Settings page shows the active state + how many
recovery codes are left:

![Settings page with 2FA enabled](img/settings-2fa-on.png)

Login becomes two-step: email + master password (the existing screen),
then a 6-digit code on a second screen. Recovery codes work in place
of the 6-digit code (and are consumed on first use — `9 remaining`
becomes `8`):

![Two-factor verification step on login](img/login-otp.png)

> **Trade-off, plainly stated.** TOTP is **not** zero-knowledge —
> RFC 6238 requires the verifier to know the shared secret, so the
> server now holds your OTP secret alongside the existing auth_key
> hash. Vault contents stay zero-knowledge: a server breach that leaks
> both still can't decrypt your credentials. The benefit is that
> credential-stuffing or phishing attacks against the password alone
> can't get past login.
>
> If you need the strongest server-side guarantee, leave 2FA off —
> the original posture (auth_key + master-password-derived key) is
> already strong against offline attacks. WebAuthn / passkeys are the
> tracked alternative for users who want a second factor without
> server-side secrets.

To turn 2FA off: Settings → **Disable 2FA** → enter a current code or
a recovery code. A stolen access token alone can't downgrade — the
disable endpoint always requires fresh proof.

---

## 6. Chrome extension

The extension is now buildable and loadable. From the repo root:

```bash
npm install
npm run build --workspace=@passman/core      # core types must build first
npm run build --workspace=@passman/extension # produces packages/extension/dist/
```

Then in Chrome / Edge / Brave: `chrome://extensions` → toggle
**Developer mode** → **Load unpacked** → pick
`packages/extension/dist/`. The Passman icon appears in your toolbar.

### 6a. Locked popup

![Extension popup — locked](img/extension-locked.png)

Same email + master password you use on the web vault. The extension's
service worker performs the same client-side derivation + unlock, then
keeps the decrypted symmetric key in memory only.

### 6b. Unlocked popup

![Extension popup — unlocked](img/extension-unlocked.png)

While unlocked, the content script can offer **exact-origin autofill**
on saved logins — it only suggests a credential when the page's origin
matches the URL stored on the item.

---

## 7. White-label branding

Passman ships unbranded by default, but a single `branding.json` file
swaps the logo, app name, tagline, and accent colour app-wide. No
rebuild required — operators edit one file (or mount it as a
ConfigMap) and the same web bundle serves any company.

The login page below shows what the default and a custom override look
like side by side:

| Default                        | White-labelled                          |
| ------------------------------ | --------------------------------------- |
| ![Default Passman](img/login.png) | ![Acme Vault override](img/login-whitelabel.png) |

The brand colour cascades to every accent in the UI — the Connect
button on every grid row, the focus rings, the protocol pills, the
selection highlight. Setting `brandColor` once re-themes the whole
product.

See [`docs/BRANDING.md`](BRANDING.md) for the full field reference,
CSP notes, and a 60-second quick-start.

---

## 8. Tips

- **Use the protocol field.** Even if Passman can infer the protocol
  from the port, declaring it explicitly is what unlocks the right
  Connect actions in the dialog and the engine tile in the grid.
- **Tag your environments.** A free-form `prod` / `staging` / `dev`
  tag makes the grid scannable at a glance — and the search box
  treats environments like any other field.
- **Keyboard shortcuts.** `⌘K` / `Ctrl+K` focuses the search; `Esc`
  closes the Connect dialog.
- **Master password length matters more than complexity.** Argon2id
  is tuned to take ~250 ms even on a fast laptop; a 16-character random
  passphrase is a far stronger choice than a clever 8-character one.
- **One vault per machine works fine.** Sessions are bound to refresh
  tokens, not browsers — sign in from as many devices as you like.

---

## Reproducing the screenshots

Every image in this guide is generated from a self-contained HTML
mockup under `docs/preview/`. Each mockup loads the real
`packages/web/src/styles.css`, so the rendering matches the live app
byte-for-byte — change the CSS, refresh the mockup, the screenshot
matches.

1. Start the bundled static server:

   ```bash
   node docs/preview/server.mjs
   # previews http://127.0.0.1:4173/
   ```

2. Browse `http://127.0.0.1:4173/docs/preview/` for an index of all
   pages.

3. Re-capture the PNGs with Chrome headless:

   ```bash
   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

   # Auth pages
   for page in register login; do
     "$CHROME" --headless --disable-gpu --hide-scrollbars \
       --window-size=1280,900 \
       --screenshot="docs/img/${page}.png" \
       "http://127.0.0.1:4173/docs/preview/${page}.html"
   done

   # Vault pages — wider window for the grid + sidebar
   for page in vault vault-add vault-connect; do
     "$CHROME" --headless --disable-gpu --hide-scrollbars \
       --window-size=1500,1000 \
       --screenshot="docs/img/${page}.png" \
       "http://127.0.0.1:4173/docs/preview/${page}.html"
   done

   # Extension popups
   for page in extension-locked extension-unlocked; do
     "$CHROME" --headless --disable-gpu --hide-scrollbars \
       --window-size=400,360 \
       --screenshot="docs/img/${page}.png" \
       "http://127.0.0.1:4173/docs/preview/${page}.html"
   done
   ```

   On Linux replace `$CHROME` with `chromium --headless=new` (or
   `google-chrome`).

If the live UI changes, refresh the mockups in `docs/preview/` and
re-run the loop.
