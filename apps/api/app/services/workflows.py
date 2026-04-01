from fastapi import HTTPException, status


ORDER_TRANSITIONS_BY_ACTOR = {
    "buyer": {
        "pending": {"canceled"},
        "confirmed": {"canceled"},
    },
    "seller": {
        "pending": {"confirmed", "canceled"},
        "confirmed": {"preparing", "canceled"},
        "preparing": {"ready", "canceled"},
        "ready": {"out_for_delivery", "completed"},
        "out_for_delivery": {"completed"},
    },
}


BOOKING_TRANSITIONS_BY_ACTOR = {
    "buyer": {
        "requested": {"canceled"},
        "confirmed": {"canceled"},
    },
    "seller": {
        "requested": {"confirmed", "declined", "canceled"},
        "confirmed": {"in_progress", "canceled", "no_show"},
        "in_progress": {"completed", "no_show"},
    },
}


def validate_transition(
    *,
    current_status: str,
    next_status: str,
    actor: str,
    workflow_name: str,
    transitions_by_actor: dict[str, dict[str, set[str]]],
) -> None:
    if current_status == next_status:
        return

    allowed_next_statuses = transitions_by_actor.get(actor, {}).get(current_status, set())
    if next_status not in allowed_next_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid {workflow_name} transition for {actor}: "
                f"{current_status} -> {next_status}"
            ),
        )
