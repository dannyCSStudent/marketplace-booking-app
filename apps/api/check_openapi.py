from __future__ import annotations

import json
import sys
from pathlib import Path

from app.main import app


def main() -> int:
    schema_path = Path(__file__).resolve().parents[2] / "docs" / "openapi.json"
    current_schema = json.dumps(app.openapi(), indent=2) + "\n"

    if not schema_path.exists():
      print(f"Missing OpenAPI artifact: {schema_path}")
      print("Run `pnpm --filter api openapi` to generate it.")
      return 1

    existing_schema = schema_path.read_text(encoding="utf-8")

    if existing_schema != current_schema:
        print(f"OpenAPI artifact is stale: {schema_path}")
        print("Run `pnpm --filter api openapi` and commit the updated docs/openapi.json.")
        return 1

    print(f"OpenAPI artifact is up to date: {schema_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
