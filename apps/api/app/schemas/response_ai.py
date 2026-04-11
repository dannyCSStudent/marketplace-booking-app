from pydantic import BaseModel


class TransactionResponseAiAssistSuggestion(BaseModel):
    suggested_note: str
    summary: str


class TransactionResponseAiAssistResponse(BaseModel):
    transaction_kind: str
    transaction_id: str
    suggestion: TransactionResponseAiAssistSuggestion
