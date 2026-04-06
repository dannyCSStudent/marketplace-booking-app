from fastapi import Depends, HTTPException, status

from app.core.config import get_settings
from app.dependencies.auth import CurrentUser, get_current_user


def require_admin_user(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    settings = get_settings()
    if current_user.id not in settings.admin_user_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
