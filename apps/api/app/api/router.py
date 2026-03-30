from fastapi import APIRouter

from app.routers.health import router as health_router
from app.routers.profiles import router as profiles_router
from app.routers.sellers import router as sellers_router
from app.routers.listings import router as listings_router
from app.routers.orders import router as orders_router
from app.routers.bookings import router as bookings_router

api_router = APIRouter()

api_router.include_router(health_router, tags=["health"])
api_router.include_router(profiles_router, prefix="/profiles", tags=["profiles"])
api_router.include_router(sellers_router, prefix="/sellers", tags=["sellers"])
api_router.include_router(listings_router, prefix="/listings", tags=["listings"])
api_router.include_router(orders_router, prefix="/orders", tags=["orders"])
api_router.include_router(bookings_router, prefix="/bookings", tags=["bookings"])