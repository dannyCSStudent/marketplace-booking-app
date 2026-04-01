from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client

@dataclass
class CurrentUser:
    id: str
    email: str | None = None
    access_token: str | None = None

def get_current_user(
    authorization: str | None = Header(default=None),
    supabase=Depends(get_supabase_client),
) -> CurrentUser:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be a Bearer token",
        )

    try:
        user = supabase.get_user(token)
    except SupabaseError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=exc.detail,
        ) from exc

    return CurrentUser(id=user.id, email=user.email, access_token=token)
