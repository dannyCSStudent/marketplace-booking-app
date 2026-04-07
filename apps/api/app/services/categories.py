from fastapi import HTTPException

from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client
from app.schemas.categories import CategoryRead


def list_public_categories() -> list[CategoryRead]:
    supabase = get_supabase_client()

    try:
        rows = supabase.select(
            "categories",
            query={
                "select": "id,name,slug,parent_id",
                "order": "name.asc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [CategoryRead(**row) for row in rows]
