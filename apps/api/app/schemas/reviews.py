from datetime import datetime

from pydantic import BaseModel, Field


class ReviewRead(BaseModel):
    id: str
    rating: int
    comment: str | None = None
    seller_response: str | None = None
    seller_responded_at: datetime | None = None
    is_hidden: bool = False
    hidden_at: datetime | None = None
    created_at: datetime


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = None
    order_id: str | None = None
    booking_id: str | None = None


class ReviewLookup(BaseModel):
    review: ReviewRead | None = None


class ReviewSellerResponseUpdate(BaseModel):
    seller_response: str | None = None


class ReviewReportCreate(BaseModel):
    reason: str
    notes: str | None = None


class ReviewReportRead(BaseModel):
    id: str
    review_id: str
    reporter_id: str
    reason: str
    notes: str | None = None
    status: str
    created_at: datetime


class ReviewReportStatusUpdate(BaseModel):
    status: str
    moderator_note: str | None = None
    resolution_reason: str | None = None
    assignee_user_id: str | None = None
    is_escalated: bool | None = None


class ReviewModerationEventRead(BaseModel):
    id: str
    actor_user_id: str
    action: str
    note: str | None = None
    created_at: datetime


class ReviewModerationItem(BaseModel):
    id: str
    review_id: str
    reporter_id: str
    seller_id: str | None = None
    reason: str
    notes: str | None = None
    status: str
    moderator_note: str | None = None
    resolution_reason: str | None = None
    assignee_user_id: str | None = None
    assigned_at: datetime | None = None
    is_escalated: bool = False
    escalated_at: datetime | None = None
    created_at: datetime
    review: ReviewRead
    seller_display_name: str | None = None
    seller_slug: str | None = None
    history: list[ReviewModerationEventRead] = []


class ReviewVisibilityUpdate(BaseModel):
    is_hidden: bool
    report_id: str | None = None
