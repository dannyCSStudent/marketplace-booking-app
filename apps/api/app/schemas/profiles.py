from typing import Any

from pydantic import BaseModel, Field

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
    admin_monetization_preferences: dict[str, Any] = Field(default_factory=dict)
    admin_delivery_ops_preferences: dict[str, Any] = Field(default_factory=dict)
    admin_review_moderation_preferences: dict[str, Any] = Field(default_factory=dict)
    admin_transaction_support_preferences: dict[str, Any] = Field(default_factory=dict)

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
    admin_monetization_preferences: dict[str, Any] | None = None
    admin_delivery_ops_preferences: dict[str, Any] | None = None
    admin_review_moderation_preferences: dict[str, Any] | None = None
    admin_transaction_support_preferences: dict[str, Any] | None = None

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
    admin_monetization_preferences: dict[str, Any] = Field(default_factory=dict)
    admin_delivery_ops_preferences: dict[str, Any] = Field(default_factory=dict)
    admin_review_moderation_preferences: dict[str, Any] = Field(default_factory=dict)
    admin_transaction_support_preferences: dict[str, Any] = Field(default_factory=dict)
