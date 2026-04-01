from functools import lru_cache

from app.core.config import get_settings
from app.core.supabase import SupabaseClient


@lru_cache
def get_supabase_client() -> SupabaseClient:
    return SupabaseClient(get_settings())
