from dataclasses import dataclass

from fastapi import Header, HTTPException, status

@dataclass
class CurrentUser:
    id: str
    email: str | None = None

def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    """
    Placeholder auth dependency.

    Replace this with real Supabase JWT verification.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    return CurrentUser(
        id="mock-user-id",
        email="mock@example.com",
    )