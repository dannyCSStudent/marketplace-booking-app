from pydantic import BaseModel


class CategoryRead(BaseModel):
    id: str
    name: str
    slug: str
    parent_id: str | None = None
