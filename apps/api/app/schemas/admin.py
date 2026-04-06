from pydantic import BaseModel


class AdminUserRead(BaseModel):
    id: str
    full_name: str | None = None
    username: str | None = None
    email: str | None = None
    role: str | None = None
