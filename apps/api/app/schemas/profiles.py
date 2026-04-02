from pydantic import BaseModel

class ProfileCreate(BaseModel):
    full_name: str | None = None
    username: str | None = None
    phone: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    email_notifications_enabled: bool = True
    push_notifications_enabled: bool = True
    marketing_notifications_enabled: bool = False
    expo_push_token: str | None = None

class ProfileUpdate(BaseModel):
    full_name: str | None = None
    username: str | None = None
    phone: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    email_notifications_enabled: bool | None = None
    push_notifications_enabled: bool | None = None
    marketing_notifications_enabled: bool | None = None
    expo_push_token: str | None = None

class ProfileRead(BaseModel):
    id: str
    full_name: str | None = None
    username: str | None = None
    phone: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    email_notifications_enabled: bool = True
    push_notifications_enabled: bool = True
    marketing_notifications_enabled: bool = False
    expo_push_token: str | None = None
