"""Timing-attack regression test for the unknown-user vs wrong-password paths.

The login endpoint must take roughly the same wall-time whether the email
is unregistered or the password is wrong; otherwise the response time
becomes an oracle for email enumeration. See ``server/src/passman/auth.py``
for the dummy-verify mechanism this test guards.
"""

from __future__ import annotations

import statistics
import time

import pytest

from .conftest import make_register_payload


def _median_ms(samples_s: list[float]) -> float:
    return statistics.median(samples_s) * 1000.0


@pytest.mark.asyncio
async def test_unknown_user_and_wrong_password_have_similar_timing(client) -> None:  # type: ignore[no-untyped-def]
    """Regression: response time for unknown-email login must be close to wrong-password login.

    We use generous bounds (median ratio within 0.5x..2.0x) — the goal is to catch
    the *category* of bug where one path skips Argon2 entirely, not to assert
    sub-millisecond parity which is impossible on a shared CI runner.
    """
    # Set up a known user so we can exercise the wrong-password path.
    reg = make_register_payload("known-timing@example.com")
    r = await client.post("/api/accounts/register", json=reg)
    assert r.status_code == 201

    samples_known = []
    samples_unknown = []

    # Warmup — first call sets up the cached hasher / dummy hash.
    await client.post(
        "/api/sessions",
        json={"email": "warmup-unknown@example.com", "auth_key": "z" * 64},
    )

    n = 5
    for _ in range(n):
        t0 = time.perf_counter()
        r = await client.post(
            "/api/sessions",
            json={"email": "known-timing@example.com", "auth_key": "z" * 64},
        )
        samples_known.append(time.perf_counter() - t0)
        assert r.status_code == 401

        t0 = time.perf_counter()
        r = await client.post(
            "/api/sessions",
            json={"email": "unknown-timing@example.com", "auth_key": "z" * 64},
        )
        samples_unknown.append(time.perf_counter() - t0)
        assert r.status_code == 401

    known_ms = _median_ms(samples_known)
    unknown_ms = _median_ms(samples_unknown)
    ratio = unknown_ms / known_ms if known_ms > 0 else 0

    # Print for diagnostics on CI failures.
    print(f"\nknown-bad   median: {known_ms:.2f} ms")
    print(f"unknown     median: {unknown_ms:.2f} ms")
    print(f"unknown/known ratio: {ratio:.2f}")

    # If the unknown path is bypassing Argon2 entirely, the ratio collapses
    # toward zero (e.g. 0.01); if it ever does double the work, ratio explodes.
    # 0.5..2.0 leaves plenty of headroom for noisy CI.
    assert 0.5 <= ratio <= 2.0, (
        f"Login timing oracle: known-bad={known_ms:.1f}ms unknown={unknown_ms:.1f}ms "
        f"(ratio={ratio:.2f}, expected 0.5..2.0)"
    )
