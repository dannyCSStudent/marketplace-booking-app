from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = ROOT / "docs" / "openapi.json"
OUTPUT_PATH = ROOT / "packages" / "api-client" / "src" / "generated" / "openapi.ts"

SCALAR_TYPES = {
    "string": "string",
    "integer": "number",
    "number": "number",
    "boolean": "boolean",
    "null": "null",
}


def _quote(value: str) -> str:
    return json.dumps(value)


def _wrap_array_item(type_name: str) -> str:
    if "\n" in type_name or "|" in type_name or "&" in type_name:
        return f"({type_name})"
    return type_name


def _is_identifier(name: str) -> bool:
    return name.replace("_", "").isalnum() and not name[0].isdigit()


def _property_name(name: str) -> str:
    return name if _is_identifier(name) else _quote(name)


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            output.append(item)
    return output


def schema_to_ts(schema: dict[str, Any] | None, *, indent: int = 0) -> str:
    if not schema:
        return "unknown"

    if "$ref" in schema:
        return schema["$ref"].rsplit("/", maxsplit=1)[-1]

    if "enum" in schema:
        return " | ".join(_quote(str(item)) for item in schema["enum"])

    if "anyOf" in schema:
        variants = _dedupe([schema_to_ts(variant, indent=indent) for variant in schema["anyOf"]])
        return " | ".join(variants)

    schema_type = schema.get("type")

    if schema_type in SCALAR_TYPES:
        return SCALAR_TYPES[schema_type]

    if schema_type == "array":
        item_type = schema_to_ts(schema.get("items"), indent=indent)
        return f"{_wrap_array_item(item_type)}[]"

    if schema_type == "object" or "properties" in schema or "additionalProperties" in schema:
        properties: dict[str, Any] = schema.get("properties", {})
        required = set(schema.get("required", []))
        additional_properties = schema.get("additionalProperties")

        if not properties and not additional_properties:
            return "Record<string, unknown>"

        padding = " " * indent
        nested_padding = " " * (indent + 2)
        lines = ["{"]

        for name, property_schema in properties.items():
            optional = "?" if name not in required else ""
            property_type = schema_to_ts(property_schema, indent=indent + 2)
            lines.append(
                f"{nested_padding}{_property_name(name)}{optional}: {property_type};"
            )

        if additional_properties:
            additional_type = (
                schema_to_ts(additional_properties, indent=indent + 2)
                if isinstance(additional_properties, dict)
                else "unknown"
            )
            lines.append(f"{nested_padding}[key: string]: {additional_type};")

        lines.append(f"{padding}}}")
        return "\n".join(lines)

    return "unknown"


def response_schema_to_ts(operation: dict[str, Any]) -> str:
    for status_code in ("200", "201", "202", "204"):
        response = operation.get("responses", {}).get(status_code)
        if not response:
            continue

        content = response.get("content", {}).get("application/json")
        if not content:
            return "void"

        return schema_to_ts(content.get("schema"))

    return "unknown"


def request_schema_to_ts(operation: dict[str, Any]) -> str | None:
    content = (
        operation.get("requestBody", {})
        .get("content", {})
        .get("application/json")
    )
    if not content:
        return None
    return schema_to_ts(content.get("schema"))


def render_types(spec: dict[str, Any]) -> str:
    schemas = spec.get("components", {}).get("schemas", {})
    paths = spec.get("paths", {})

    lines = [
        "// This file is auto-generated from docs/openapi.json.",
        "// Do not edit it by hand. Run `pnpm --filter api openapi:types`.",
        "",
    ]

    for name in sorted(schemas):
        rendered = schema_to_ts(schemas[name], indent=2)
        lines.append(f"export type {name} = {rendered};")
        lines.append("")

    lines.append("export type ApiSchemaMap = {")
    for name in sorted(schemas):
        lines.append(f"  {name}: {name};")
    lines.extend(["};", "", "export type ApiOperations = {"])

    for path_name in sorted(paths):
        lines.append(f"  {_quote(path_name)}: {{")
        operations = paths[path_name]

        for method in sorted(operations):
            operation = operations[method]
            response_type = response_schema_to_ts(operation)
            request_type = request_schema_to_ts(operation)
            lines.append(f"    {method}: {{")
            if request_type is not None:
                lines.append(f"      requestBody: {request_type};")
            lines.append(f"      response: {response_type};")
            lines.append("    };")

        lines.append("  };")

    lines.extend(["};", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    spec = json.loads(OPENAPI_PATH.read_text())
    rendered = render_types(spec)

    if args.check:
        if not OUTPUT_PATH.exists():
            print(f"Generated OpenAPI types are missing: {OUTPUT_PATH}")
            print("Run `pnpm --filter api openapi:types`.")
            return 1

        current = OUTPUT_PATH.read_text()
        if current != rendered:
            print(f"Generated OpenAPI types are stale: {OUTPUT_PATH}")
            print("Run `pnpm --filter api openapi:types`.")
            return 1

        print(f"Generated OpenAPI types are up to date: {OUTPUT_PATH}")
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(rendered)
    print(f"Wrote generated OpenAPI types to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
