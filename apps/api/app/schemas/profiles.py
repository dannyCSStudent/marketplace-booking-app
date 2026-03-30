from pydantic import BaseModel

class ProfileCreate(BaseModel):
    full_name: str | None = None
    username: str | None = None
    phone: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None

class ProfileUpdate(BaseModel):
    full_name: str | None = None
    username: str | None = None
    phone: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None

class ProfileRead(BaseModel):
    id: str
    full_name: str | None = None
    username: str | None = None
    phone: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None