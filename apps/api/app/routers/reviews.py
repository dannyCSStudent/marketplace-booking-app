from fastapi import APIRouter, Depends, Query, status

from app.dependencies.admin import require_admin_user
from app.dependencies.auth import get_current_user
from app.schemas.reviews import (
    ReviewCreate,
    ReviewAnomalyRead,
    ReviewAnomalySellerSummaryRead,
    ReviewLookup,
    ReviewModerationItem,
    ReviewRead,
    ReviewReportCreate,
    ReviewReportRead,
    ReviewReportStatusUpdate,
    ReviewResponseAiAssistResponse,
    ReviewSellerResponseUpdate,
    ReviewVisibilityUpdate,
)
from app.schemas.notifications import NotificationDeliveryRead
from app.services.reviews import (
    create_review,
    create_review_report,
    acknowledge_review_anomaly,
    clear_review_anomaly_acknowledgement,
    get_my_review_lookup,
    list_review_anomalies,
    list_review_anomaly_seller_summaries,
    list_review_reports,
    generate_review_response_ai_assist,
    update_review_seller_response,
    update_review_report_status,
    update_review_visibility,
)

router = APIRouter()


@router.get("/me/lookup", response_model=ReviewLookup)
def read_my_review_lookup(
    order_id: str | None = Query(default=None),
    booking_id: str | None = Query(default=None),
    current_user=Depends(get_current_user),
) -> ReviewLookup:
    return get_my_review_lookup(
        current_user,
        order_id=order_id,
        booking_id=booking_id,
    )


@router.post("", response_model=ReviewRead, status_code=status.HTTP_201_CREATED)
def create_my_review(
    payload: ReviewCreate,
    current_user=Depends(get_current_user),
) -> ReviewRead:
    return create_review(current_user, payload)


@router.patch("/{review_id}/seller-response", response_model=ReviewRead)
def patch_review_seller_response(
    review_id: str,
    payload: ReviewSellerResponseUpdate,
    current_user=Depends(get_current_user),
) -> ReviewRead:
    return update_review_seller_response(current_user, review_id, payload)


@router.post("/{review_id}/ai-assist", response_model=ReviewResponseAiAssistResponse)
def request_review_response_ai_assist(
    review_id: str,
    current_user=Depends(get_current_user),
) -> ReviewResponseAiAssistResponse:
    return generate_review_response_ai_assist(current_user, review_id)


@router.post("/{review_id}/report", response_model=ReviewReportRead, status_code=status.HTTP_201_CREATED)
def create_my_review_report(
    review_id: str,
    payload: ReviewReportCreate,
    current_user=Depends(get_current_user),
) -> ReviewReportRead:
    return create_review_report(current_user, review_id, payload)


@router.get("/reports", response_model=list[ReviewModerationItem])
def read_review_reports(
    status_value: str = Query(default="open", alias="status"),
    current_user=Depends(require_admin_user),
) -> list[ReviewModerationItem]:
    return list_review_reports(status_filter=status_value)


@router.get("/anomalies", response_model=list[ReviewAnomalyRead])
def read_review_anomalies(
    limit: int = Query(default=8, ge=1, le=20),
    current_user=Depends(require_admin_user),
) -> list[ReviewAnomalyRead]:
    return list_review_anomalies(limit=limit)


@router.get("/anomalies/sellers", response_model=list[ReviewAnomalySellerSummaryRead])
def read_review_anomaly_sellers(
    limit: int = Query(default=6, ge=1, le=20),
    current_user=Depends(require_admin_user),
) -> list[ReviewAnomalySellerSummaryRead]:
    return list_review_anomaly_seller_summaries(limit=limit)


@router.post("/anomalies/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def acknowledge_review_anomaly_lane(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return acknowledge_review_anomaly(seller_id, actor_user_id=current_user.id)


@router.delete("/anomalies/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def clear_review_anomaly_lane_acknowledgement(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return clear_review_anomaly_acknowledgement(seller_id, actor_user_id=current_user.id)


@router.patch("/reports/{report_id}", response_model=ReviewModerationItem)
def patch_review_report_status(
    report_id: str,
    payload: ReviewReportStatusUpdate,
    current_user=Depends(require_admin_user),
) -> ReviewModerationItem:
    return update_review_report_status(current_user, report_id, payload)


@router.patch("/{review_id}/visibility", response_model=ReviewRead)
def patch_review_visibility(
    review_id: str,
    payload: ReviewVisibilityUpdate,
    current_user=Depends(require_admin_user),
) -> ReviewRead:
    return update_review_visibility(current_user, review_id, payload)
