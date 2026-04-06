from fastapi import APIRouter, Depends

from app.dependencies.admin import require_admin_user
from app.schemas.admin import AdminUserRead
from app.services.admin import list_admin_users

router = APIRouter()


@router.get("/users", response_model=list[AdminUserRead])
def read_admin_users(current_user=Depends(require_admin_user)) -> list[AdminUserRead]:
    return list_admin_users()
