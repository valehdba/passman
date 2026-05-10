"""TOTP (RFC 6238) + recovery-code utilities.

Hand-rolled rather than pulling `pyotp` to keep the dependency surface
minimal — the logic is ~50 lines of well-trodden, easily-audited code.

Defaults match what every authenticator app expects out of the box:
  - HMAC-SHA1
  - 30-second period
  - 6-digit codes
  - ±1 window tolerance for clock skew
"""

from __future__ import annotations

import base64
import hmac
import json
import secrets
import struct
import time
from hashlib import sha1
from typing import Iterable

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

# RFC 6238 §5.1: 20 bytes is the recommended secret size for HMAC-SHA1.
SECRET_BYTES = 20
PERIOD_SECONDS = 30
DIGITS = 6
# Number of recovery codes generated when 2FA is enabled. Industry norm is 8–10.
RECOVERY_CODE_COUNT = 10
# Codes are formatted as `xxxx-xxxx` (8 chars + dash) — readable + unambiguous.
RECOVERY_CODE_BYTES = 5  # 5 bytes -> 8 base32 chars (no padding)

# Argon2id is overkill for short alphanumeric codes but matches our
# password-hashing posture and avoids a bcrypt dep.
_recovery_hasher = PasswordHasher()


def generate_secret() -> bytes:
    """Generate a fresh CSPRNG-backed TOTP secret."""
    return secrets.token_bytes(SECRET_BYTES)


def secret_to_base32(secret: bytes) -> str:
    """Encode the binary secret as the base32 form authenticator apps expect.

    The QR code's `otpauth://` URL embeds this; manual-entry users type it.
    """
    # Most authenticator apps tolerate trailing `=` padding but the cleanest
    # presentation is no padding — strip it.
    return base64.b32encode(secret).decode("ascii").rstrip("=")


def base32_to_secret(b32: str) -> bytes:
    """Inverse of `secret_to_base32` — accepts strings with or without padding."""
    s = b32.strip().replace(" ", "").upper()
    # Re-add the `=` padding base64 module expects (b32 alphabet uses 8-char blocks).
    pad_len = (-len(s)) % 8
    return base64.b32decode(s + "=" * pad_len)


def build_provisioning_uri(secret: bytes, account: str, issuer: str) -> str:
    """Construct the standard `otpauth://totp/...?secret=...&issuer=...` URI.

    Format defined at https://github.com/google/google-authenticator/wiki/Key-Uri-Format.
    The label is `<issuer>:<account>` so phones group entries by issuer.
    """
    from urllib.parse import quote

    label = f"{quote(issuer, safe='')}:{quote(account, safe='')}"
    params = (
        f"secret={secret_to_base32(secret)}"
        f"&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1"
        f"&digits={DIGITS}"
        f"&period={PERIOD_SECONDS}"
    )
    return f"otpauth://totp/{label}?{params}"


def _hotp(secret: bytes, counter: int, digits: int = DIGITS) -> str:
    """RFC 4226 HOTP — the building block TOTP windows over."""
    msg = struct.pack(">Q", counter)
    digest = hmac.new(secret, msg, sha1).digest()
    # Dynamic truncation per RFC 4226 §5.3.
    offset = digest[-1] & 0x0F
    code_int = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    return str(code_int % (10**digits)).zfill(digits)


def current_code(secret: bytes, at_time: float | None = None) -> str:
    """Compute the TOTP code for `at_time` (defaults to now). Used by tests
    and the docs example; production verification calls `verify` instead."""
    t = at_time if at_time is not None else time.time()
    return _hotp(secret, int(t // PERIOD_SECONDS))


def verify(secret: bytes, code: str, at_time: float | None = None, window: int = 1) -> bool:
    """Constant-time-ish verify of a 6-digit TOTP code against `secret`.

    Accepts codes from the previous, current, and next window (the ±1
    default) to tolerate clock skew up to ~30 seconds. Wider windows
    weaken security; narrower ones break in practice.

    Code is normalised — strips whitespace, dashes — so users pasting
    "123 456" or "123-456" work. Non-digit codes are rejected.
    """
    cleaned = "".join(ch for ch in code if ch.isdigit())
    if len(cleaned) != DIGITS:
        return False
    t = at_time if at_time is not None else time.time()
    counter = int(t // PERIOD_SECONDS)
    # `hmac.compare_digest` is the constant-time string compare the stdlib
    # provides; we use it on each candidate to keep timing leakage minimal.
    for offset in range(-window, window + 1):
        expected = _hotp(secret, counter + offset)
        if hmac.compare_digest(expected, cleaned):
            return True
    return False


# ----- Recovery codes ---------------------------------------------------------


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Generate `count` single-use recovery codes formatted as `xxxx-xxxx`.

    The plaintext list is returned to the caller exactly once; only the
    Argon2id-hashed forms are persisted server-side. If the user loses
    the printed list, they have to disable + re-enable 2FA.
    """
    out: list[str] = []
    for _ in range(count):
        # 5 random bytes → base32 → 8 chars. Split for readability.
        raw = base64.b32encode(secrets.token_bytes(RECOVERY_CODE_BYTES)).decode("ascii").rstrip("=")
        # Defensive — unlikely-but-possible padding edge cases.
        raw = raw[:8].lower()
        out.append(f"{raw[:4]}-{raw[4:]}")
    return out


def hash_recovery_codes(codes: Iterable[str]) -> str:
    """Argon2id-hash each code and JSON-encode the resulting list. The
    server stores this string; never the plaintext codes."""
    hashes = [_recovery_hasher.hash(c.lower().strip()) for c in codes]
    return json.dumps(hashes)


def consume_recovery_code(stored_hashes_json: str, code: str) -> tuple[bool, str | None]:
    """Try to redeem `code` against the stored hashes.

    Returns `(matched, remaining_json)`:
      - if matched, `remaining_json` is the new JSON list with the used
        hash stripped (caller persists it back)
      - if no match, `remaining_json` is None (caller leaves the column
        unchanged — no information leak from a partial write)

    Recovery codes are single-use by design, hence the strip-on-match.
    """
    try:
        hashes: list[str] = json.loads(stored_hashes_json)
    except (ValueError, TypeError):
        return False, None
    cleaned = code.lower().strip().replace(" ", "")
    for i, h in enumerate(hashes):
        try:
            if _recovery_hasher.verify(h, cleaned):
                remaining = hashes[:i] + hashes[i + 1 :]
                return True, json.dumps(remaining)
        except VerifyMismatchError:
            continue
        except Exception:
            # Argon2 raises a few non-VerifyMismatch errors for malformed
            # hashes — treat as "no match" and keep going so a single
            # corrupt entry doesn't lock out the user.
            continue
    return False, None
