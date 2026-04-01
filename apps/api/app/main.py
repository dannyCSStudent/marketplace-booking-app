from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from app.api.router import api_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Marketplace Booking API",
    version="0.1.0",
)

default_allowed_origins = [
    "http://localhost:3000",
    "http://localhost:8081",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8081",
]

configured_allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_allowed_origins or default_allowed_origins,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(api_router)
