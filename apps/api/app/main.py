# apps/api/main.py
from fastapi import FastAPI

app = FastAPI(title="Starter API")

@app.get("/health")
def health():
    return {"status": "ok"}