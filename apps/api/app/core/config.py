import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str | None
    supabase_schema: str = "public"
    cors_origins: tuple[str, ...] = ()
    notification_email_provider: str = "log"
    notification_push_provider: str = "log"
    notification_email_webhook_url: str | None = None
    notification_push_webhook_url: str | None = None
    notification_max_attempts: int = 3
    resend_api_key: str | None = None
    expo_access_token: str | None = None
    notification_from_email: str | None = None
    notification_worker_poll_seconds: int = 30
    notification_worker_batch_size: int = 25
    notification_sent_retention_days: int = 14
    notification_failed_retention_days: int = 30
    notification_maintenance_poll_seconds: int = 21600


def get_settings() -> Settings:
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    supabase_anon_key = os.getenv("SUPABASE_ANON_KEY", "")
    supabase_service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    supabase_schema = os.getenv("SUPABASE_SCHEMA", "public")
    cors_origins_raw = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    cors_origins = tuple(
        origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()
    )
    notification_email_provider = os.getenv("NOTIFICATION_EMAIL_PROVIDER", "log")
    notification_push_provider = os.getenv("NOTIFICATION_PUSH_PROVIDER", "log")
    notification_email_webhook_url = os.getenv("NOTIFICATION_EMAIL_WEBHOOK_URL")
    notification_push_webhook_url = os.getenv("NOTIFICATION_PUSH_WEBHOOK_URL")
    notification_max_attempts = int(os.getenv("NOTIFICATION_MAX_ATTEMPTS", "3"))
    resend_api_key = os.getenv("RESEND_API_KEY")
    expo_access_token = os.getenv("EXPO_ACCESS_TOKEN")
    notification_from_email = os.getenv("NOTIFICATION_FROM_EMAIL", "onboarding@resend.dev")
    notification_worker_poll_seconds = int(os.getenv("NOTIFICATION_WORKER_POLL_SECONDS", "30"))
    notification_worker_batch_size = int(os.getenv("NOTIFICATION_WORKER_BATCH_SIZE", "25"))
    notification_sent_retention_days = int(os.getenv("NOTIFICATION_SENT_RETENTION_DAYS", "14"))
    notification_failed_retention_days = int(os.getenv("NOTIFICATION_FAILED_RETENTION_DAYS", "30"))
    notification_maintenance_poll_seconds = int(
        os.getenv("NOTIFICATION_MAINTENANCE_POLL_SECONDS", "21600")
    )

    if not supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured")

    if not supabase_anon_key:
        raise RuntimeError("SUPABASE_ANON_KEY is not configured")
    
    if notification_email_provider == "resend" and not resend_api_key:
        raise RuntimeError("RESEND_API_KEY is required when NOTIFICATION_EMAIL_PROVIDER=resend")

    return Settings(
        supabase_url=supabase_url,
        supabase_anon_key=supabase_anon_key,
        supabase_service_role_key=supabase_service_role_key,
        supabase_schema=supabase_schema,
        cors_origins=cors_origins,
        notification_email_provider=notification_email_provider,
        notification_push_provider=notification_push_provider,
        notification_email_webhook_url=notification_email_webhook_url,
        notification_push_webhook_url=notification_push_webhook_url,
        notification_max_attempts=notification_max_attempts,
        resend_api_key=resend_api_key,
        expo_access_token=expo_access_token,
        notification_from_email=notification_from_email,
        notification_worker_poll_seconds=notification_worker_poll_seconds,
        notification_worker_batch_size=notification_worker_batch_size,
        notification_sent_retention_days=notification_sent_retention_days,
        notification_failed_retention_days=notification_failed_retention_days,
        notification_maintenance_poll_seconds=notification_maintenance_poll_seconds,
    )
