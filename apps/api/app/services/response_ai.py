from app.schemas.response_ai import (
    TransactionResponseAiAssistResponse,
    TransactionResponseAiAssistSuggestion,
)


def build_transaction_response_ai_suggestion(
    *,
    transaction_kind: str,
    transaction_status: str,
    buyer_notes: str | None,
    buyer_context: str | None,
    transaction_label: str | None = None,
) -> TransactionResponseAiAssistSuggestion:
    label = (transaction_label or transaction_kind).strip() or "transaction"
    status = transaction_status.replace("_", " ").strip().lower()
    note_excerpt = (buyer_notes or "").strip()
    context_excerpt = (buyer_context or "").strip()
    note_excerpt = note_excerpt[:120].rstrip()
    context_excerpt = context_excerpt[:90].rstrip()

    if transaction_kind == "booking":
        if transaction_status in {"confirmed", "completed"}:
            opening = "Thanks for confirming the booking"
            closing = "We’re looking forward to making it a smooth appointment."
        elif transaction_status in {"requested", "pending"}:
            opening = "Thanks for the booking request"
            closing = "We’ll review the timing and follow up soon."
        else:
            opening = "Thanks for the update on this booking"
            closing = "We’ll keep the next step clear and timely."
    else:
        if transaction_status in {"confirmed", "completed"}:
            opening = "Thanks for confirming the order"
            closing = "We appreciate the chance to take care of it."
        elif transaction_status in {"ready", "in_progress"}:
            opening = "Thanks for the order update"
            closing = "We’ll keep the order moving and let you know if anything changes."
        else:
            opening = "Thanks for the order note"
            closing = "We’ll keep the process moving and stay in touch."

    parts = [f"{opening}."]
    if note_excerpt:
        parts.append(f'We noticed the note: “{note_excerpt}”.')
    if context_excerpt:
        parts.append(f"Context: {context_excerpt}.")
    parts.append(closing)

    summary = f"{transaction_kind.title()} reply suggestion based on the current {status} state."
    if note_excerpt:
        summary = f"{summary} Personalizes around the buyer note."

    return TransactionResponseAiAssistSuggestion(
        suggested_note=" ".join(parts),
        summary=summary,
    )


def build_transaction_response_ai_response(
    *,
    transaction_kind: str,
    transaction_id: str,
    transaction_status: str,
    buyer_notes: str | None,
    buyer_context: str | None,
    transaction_label: str | None = None,
) -> TransactionResponseAiAssistResponse:
    return TransactionResponseAiAssistResponse(
        transaction_kind=transaction_kind,
        transaction_id=transaction_id,
        suggestion=build_transaction_response_ai_suggestion(
            transaction_kind=transaction_kind,
            transaction_status=transaction_status,
            buyer_notes=buyer_notes,
            buyer_context=buyer_context,
            transaction_label=transaction_label,
        ),
    )
