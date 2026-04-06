import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import Settings


class SupabaseError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class SupabaseUser:
    id: str
    email: str | None


class SupabaseClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.rest_base_url = f"{settings.supabase_url}/rest/v1"
        self.auth_base_url = f"{settings.supabase_url}/auth/v1"
        self.storage_base_url = f"{settings.supabase_url}/storage/v1"

    def get_user(self, access_token: str) -> SupabaseUser:
        payload = self._request(
            method="GET",
            url=f"{self.auth_base_url}/user",
            access_token=access_token,
        )
        return SupabaseUser(id=payload["id"], email=payload.get("email"))

    def list_auth_users(self) -> list[dict[str, Any]]:
        payload = self._request(
            method="GET",
            url=f"{self.auth_base_url}/admin/users?page=1&per_page=200",
            use_service_role=True,
        )
        return payload.get("users", [])

    def create_auth_user(
        self,
        *,
        email: str,
        password: str,
        email_confirm: bool = True,
        user_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = self._request(
            method="POST",
            url=f"{self.auth_base_url}/admin/users",
            body={
                "email": email,
                "password": password,
                "email_confirm": email_confirm,
                "user_metadata": user_metadata or {},
            },
            use_service_role=True,
        )
        if "user" in payload:
            return payload["user"]
        return payload

    def get_auth_user(self, user_id: str) -> dict[str, Any]:
        payload = self._request(
            method="GET",
            url=f"{self.auth_base_url}/admin/users/{user_id}",
            use_service_role=True,
        )
        if "user" in payload:
            return payload["user"]
        return payload

    def select(
        self,
        table: str,
        *,
        query: dict[str, str] | None = None,
        access_token: str | None = None,
        use_service_role: bool = False,
        expect_single: bool = False,
    ) -> Any:
        headers = {}
        if expect_single:
            headers["Accept"] = "application/vnd.pgrst.object+json"

        return self._request(
            method="GET",
            url=self._rest_url(table, query),
            headers=headers,
            access_token=access_token,
            use_service_role=use_service_role,
        )

    def insert(
        self,
        table: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        *,
        access_token: str | None = None,
        use_service_role: bool = False,
        upsert: bool = False,
    ) -> Any:
        prefer_parts = ["return=representation"]
        if upsert:
            prefer_parts.append("resolution=merge-duplicates")

        return self._request(
            method="POST",
            url=self._rest_url(table),
            headers={"Prefer": ",".join(prefer_parts)},
            body=payload,
            access_token=access_token,
            use_service_role=use_service_role,
        )

    def update(
        self,
        table: str,
        payload: dict[str, Any],
        *,
        query: dict[str, str],
        access_token: str | None = None,
        use_service_role: bool = False,
    ) -> Any:
        return self._request(
            method="PATCH",
            url=self._rest_url(table, query),
            headers={"Prefer": "return=representation"},
            body=payload,
            access_token=access_token,
            use_service_role=use_service_role,
        )

    def delete(
        self,
        table: str,
        *,
        query: dict[str, str],
        access_token: str | None = None,
        use_service_role: bool = False,
        ) -> Any:
        return self._request(
            method="DELETE",
            url=self._rest_url(table, query),
            headers={"Prefer": "return=representation"},
            access_token=access_token,
            use_service_role=use_service_role,
        )

    def upload_storage_object(
        self,
        *,
        bucket: str,
        path: str,
        payload: bytes,
        content_type: str,
        use_service_role: bool = True,
        upsert: bool = False,
    ) -> dict[str, Any]:
        return self._request_bytes(
            method="POST",
            url=f"{self.storage_base_url}/object/{bucket}/{path}",
            body=payload,
            headers={
                "Content-Type": content_type,
                "x-upsert": "true" if upsert else "false",
            },
            use_service_role=use_service_role,
        )

    def public_storage_url(self, bucket: str, path: str) -> str:
        return f"{self.storage_base_url}/object/public/{bucket}/{path}"

    def _rest_url(self, table: str, query: dict[str, str] | None = None) -> str:
        if not query:
            return f"{self.rest_base_url}/{table}"
        return f"{self.rest_base_url}/{table}?{urlencode(query)}"

    def _request(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
        access_token: str | None = None,
        use_service_role: bool = False,
    ) -> Any:
        request_headers = {
            "Content-Type": "application/json",
            "apikey": self._api_key(use_service_role=use_service_role),
        }
        request_headers.update(headers or {})

        bearer_token = access_token or self._api_key(use_service_role=use_service_role)
        request_headers["Authorization"] = f"Bearer {bearer_token}"

        if url.startswith(self.rest_base_url):
            request_headers["Accept-Profile"] = self.settings.supabase_schema
            if method in {"POST", "PATCH", "PUT", "DELETE"}:
                request_headers["Content-Profile"] = self.settings.supabase_schema

        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = Request(url=url, data=data, headers=request_headers, method=method)

        try:
            with urlopen(request) as response:
                raw_body = response.read().decode("utf-8")
                if not raw_body:
                    return None
                return json.loads(raw_body)
        except HTTPError as exc:
            self._raise_error(exc)
        except URLError as exc:
            raise SupabaseError(status_code=503, detail=f"Supabase connection failed: {exc.reason}") from exc

    def _request_bytes(
        self,
        *,
        method: str,
        url: str,
        body: bytes,
        headers: dict[str, str] | None = None,
        access_token: str | None = None,
        use_service_role: bool = False,
    ) -> Any:
        request_headers = {
            "apikey": self._api_key(use_service_role=use_service_role),
        }
        request_headers.update(headers or {})

        bearer_token = access_token or self._api_key(use_service_role=use_service_role)
        request_headers["Authorization"] = f"Bearer {bearer_token}"

        request = Request(url=url, data=body, headers=request_headers, method=method)

        try:
            with urlopen(request) as response:
                raw_body = response.read().decode("utf-8")
                if not raw_body:
                    return None
                return json.loads(raw_body)
        except HTTPError as exc:
            self._raise_error(exc)
        except URLError as exc:
            raise SupabaseError(status_code=503, detail=f"Supabase connection failed: {exc.reason}") from exc

    def _api_key(self, *, use_service_role: bool) -> str:
        if use_service_role and self.settings.supabase_service_role_key:
            return self.settings.supabase_service_role_key
        return self.settings.supabase_anon_key

    def _raise_error(self, exc: HTTPError) -> None:
        raw_body = exc.read().decode("utf-8")
        detail = raw_body or exc.reason

        try:
            payload = json.loads(raw_body)
            detail = payload.get("message") or payload.get("error_description") or payload.get("error") or detail
        except json.JSONDecodeError:
            pass

        raise SupabaseError(status_code=exc.code, detail=detail) from exc
