"""
rag_manager.py
──────────────
Lives on EVERY team member's laptop (including the server laptop).
Replaces every import of `rag_service` in your existing code.

  BEFORE:  from backend.services.rag_service import rag_service
  AFTER:   from backend.services.rag_manager import rag_manager

The local RAGService (rag_service.py) is untouched.
The shared DB is accessed via plain HTTP calls to the server laptop.

Upload scope is chosen per-call:
    scope="local"   → your laptop's ChromaDB (existing behaviour)
    scope="shared"  → server laptop's ChromaDB (new)

Search scope works the same way:
    scope="local"   → only your docs
    scope="shared"  → only company-wide docs
"""

import os
import httpx
from typing import List, Dict, Optional, Literal

# Your existing, untouched local RAG service
from backend.services.rag_service import rag_service   # ← unchanged import

# ── Config ────────────────────────────────────────────────────────────────────
# Put the server laptop's LAN IP here, or set the env var SHARED_RAG_URL.
# Example: http://192.168.1.50:8001
SHARED_RAG_URL = os.environ.get("SHARED_RAG_URL", "http://192.168.1.50:8001").rstrip("/")

# How long to wait for the shared server before giving up (seconds)
SHARED_TIMEOUT = float(os.environ.get("SHARED_RAG_TIMEOUT", "30"))

Scope = Literal["local", "shared"]


class RAGManager:
    """
    Single entry-point for all RAG operations.

    local  → delegates to rag_service (your existing ChromaDB on this laptop)
    shared → HTTP calls to shared_rag_service running on the server laptop
    """

    def __init__(self):
        # The local service is already a singleton; we just hold a reference.
        self.local = rag_service
        # Shared HTTP client — persistent connection pool, reused across calls.
        self._http = httpx.AsyncClient(
            base_url=SHARED_RAG_URL,
            timeout=SHARED_TIMEOUT,
        )

    # ── Initialization ────────────────────────────────────────────────────────

    async def initialize(self):
        """
        Call this once at FastAPI startup (in your lifespan hook).
        Initializes the local DB; the shared DB is always-on on the server.
        """
        await self.local.initialize()

        # Sanity-check: can we reach the shared server?
        try:
            resp = await self._http.get("/health")
            resp.raise_for_status()
            data = resp.json()
            print(f"🌐 Shared RAG reachable — {data.get('total_chunks', '?')} chunks in store.")
        except Exception as e:
            # Not fatal — local RAG still works if shared server is unreachable.
            print(f"⚠️  Shared RAG server not reachable at {SHARED_RAG_URL}: {e}")
            print("   Local RAG is still fully operational.")

    # ── Add document ──────────────────────────────────────────────────────────

    async def add_document(
        self,
        file_path: str,
        document_id: str,
        metadata: Optional[Dict] = None,
        scope: Scope = "local",              # ← caller decides
    ) -> int:
        """
        Index a document into local or shared DB.

        scope="local"  — stays on this laptop only
        scope="shared" — sent to the server laptop, visible to whole team
        """
        if scope == "local":
            return await self.local.add_document(
                file_path=file_path,
                document_id=document_id,
                metadata=metadata,
            )

        # scope == "shared": upload the file bytes to the shared server
        try:
            ext = os.path.splitext(file_path)[1]
            original_name = (metadata or {}).get("original_filename", os.path.basename(file_path))

            with open(file_path, "rb") as f:
                resp = await self._http.post(
                    "/documents/upload",
                    files={"file": (original_name, f, _mime(ext))},
                )
            resp.raise_for_status()
            data = resp.json()
            print(f"✅ Shared upload: {data.get('chunks_indexed')} chunks indexed.")
            return data.get("chunks_indexed", 0)

        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Shared server error {e.response.status_code}: {e.response.text}") from e
        except httpx.RequestError as e:
            raise RuntimeError(
                f"Cannot reach shared RAG server at {SHARED_RAG_URL}. "
                "Is it running? Is the laptop on the same WiFi?"
            ) from e

    # ── Search ────────────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        k: int = 5,
        filter_metadata: Optional[Dict] = None,
        scope: Scope = "local",              # ← caller decides
    ) -> List[Dict]:
        """
        Search local or shared DB — results are completely separate.

        scope="local"  → only this laptop's documents
        scope="shared" → only the company-wide shared documents
        """
        if scope == "local":
            return await self.local.search(
                query=query,
                k=k,
                filter_metadata=filter_metadata,
            )

        # scope == "shared"
        try:
            payload = {
                "query": query,
                "k": k,
            }
            if filter_metadata and "document_id" in filter_metadata:
                payload["document_id"] = filter_metadata["document_id"]

            resp = await self._http.post("/search", json=payload)
            resp.raise_for_status()
            return resp.json().get("results", [])

        except httpx.HTTPStatusError as e:
            print(f"❌ Shared search HTTP error {e.response.status_code}: {e.response.text}")
            return []
        except httpx.RequestError as e:
            print(f"❌ Shared server unreachable: {e}")
            return []

    # ── Delete ────────────────────────────────────────────────────────────────

    async def delete_document(
        self,
        document_id: str,
        scope: Scope = "local",
    ) -> bool:
        """Delete a document from local or shared DB."""
        if scope == "local":
            return await self.local.delete_document(document_id)

        try:
            resp = await self._http.delete(f"/documents/{document_id}")
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            return True
        except httpx.RequestError as e:
            print(f"❌ Shared delete failed: {e}")
            return False

    # ── List documents ────────────────────────────────────────────────────────

    async def list_documents(self, scope: Scope = "local") -> List[Dict]:
        """List indexed documents in local or shared DB."""
        if scope == "local":
            ids = await self.local.list_documents() if hasattr(self.local, "list_documents") else []
            return [{"document_id": i} for i in ids]

        try:
            resp = await self._http.get("/documents")
            resp.raise_for_status()
            return resp.json().get("documents", [])
        except httpx.RequestError as e:
            print(f"❌ Cannot list shared documents: {e}")
            return []

    # ── Statistics ────────────────────────────────────────────────────────────

    def get_local_statistics(self) -> Dict:
        """Stats for this laptop's local DB."""
        return self.local.get_statistics()

    async def get_shared_statistics(self) -> Dict:
        """Stats for the shared server DB."""
        try:
            resp = await self._http.get("/health")
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            return {"status": "unreachable", "detail": str(e)}

    # ── Cleanup ───────────────────────────────────────────────────────────────

    async def close(self):
        """Call in FastAPI shutdown to cleanly close the HTTP client."""
        await self._http.aclose()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _mime(ext: str) -> str:
    return {
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".md":  "text/markdown",
    }.get(ext.lower(), "application/octet-stream")


# Singleton — import this everywhere instead of rag_service
rag_manager = RAGManager()
