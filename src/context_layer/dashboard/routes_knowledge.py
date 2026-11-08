"""Knowledge polish routes: justification of an assertion and dedupe of the store (docs/dashboard.md)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from . import dedupe, justify
from .contracts import DedupeReport, Justification

router = APIRouter(prefix="/api")


@router.get("/assertions/{assertion_id}/justification", response_model=Justification)
def get_justification(assertion_id: str, request: Request) -> Justification:
    try:
        return justify.justify(request.app.state.wb, assertion_id)
    except KeyError:
        raise HTTPException(404, f"unknown assertion {assertion_id}") from None


@router.get("/knowledge/dedupe", response_model=DedupeReport)
def get_dedupe(request: Request) -> DedupeReport:
    return dedupe.report(request.app.state.wb)


@router.post("/knowledge/dedupe/run", response_model=DedupeReport)
def run_dedupe(request: Request) -> DedupeReport:
    """Fold the near-duplicates of the whole store (also with the setting off: the operator asked)."""
    wb = request.app.state.wb
    dedupe.dedupe_store(wb)
    return dedupe.report(wb)
