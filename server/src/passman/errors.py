"""Domain errors mapped to HTTP responses."""

from __future__ import annotations

from fastapi import HTTPException, status


class InvalidCredentialsError(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


class EmailAlreadyRegisteredError(HTTPException):
    def __init__(self) -> None:
        # Note: deliberately the same shape as InvalidCredentialsError on /login;
        # on /register we DO leak that the email is taken — this is a known
        # tradeoff for usability. To harden, consider sending a verification
        # email regardless and only completing registration after click-through.
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )


class VaultItemNotFoundError(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vault item not found",
        )


class InvalidTokenError(HTTPException):
    def __init__(self, message: str = "Invalid or expired token") -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=message,
            headers={"WWW-Authenticate": "Bearer"},
        )
