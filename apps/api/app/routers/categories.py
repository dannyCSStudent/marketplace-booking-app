from fastapi import APIRouter

from app.schemas.categories import CategoryRead
from app.services.categories import list_public_categories

router = APIRouter()


@router.get("", response_model=list[CategoryRead])
def list_categories() -> list[CategoryRead]:
    return list_public_categories()
