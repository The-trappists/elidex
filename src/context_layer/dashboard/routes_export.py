"""Knowledge export (json, markdown, csv, graphml, jsonld) and the AI activity log routes."""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime
from typing import Any
from xml.etree import ElementTree as ET

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from . import company
from .contracts import LlmSummary
from .routes import _kg, get_wb
from .state import Dashboard

router = APIRouter(prefix="/api")

FORMATS: dict[str, dict[str, str]] = {
    "json": {"ext": "json", "media_type": "application/json", "description": "Assertions, classes, class members, bindings, sources and counts as one JSON document."},
    "markdown": {"ext": "md", "media_type": "text/markdown", "description": "A readable report grouped by element and class: trust, validity and sources."},
    "csv": {"ext": "csv", "media_type": "text/csv", "description": "One flat row per assertion (list fields joined by ' | '), spreadsheet safe."},
    "graphml": {"ext": "graphml", "media_type": "application/graphml+xml", "description": "The knowledge graph (nodes and edges) for Gephi or yEd."},
    "jsonld": {"ext": "jsonld", "media_type": "application/ld+json", "description": "Assertions as a JSON-LD graph with a @context, for other systems to ingest."},
}
SCHEMA_VERSION = 1
CSV_COLUMNS = [
    "id", "type", "topic", "summary", "fact", "diagnosis", "action", "avoid", "conditions", "bound_to",
    "valid_from", "valid_to", "closed_by", "trust_level", "stated_by", "confidence", "sources", "conflicts_with",
]


# ---------------------------------------------------------------- formats


def to_markdown(pkg: dict[str, Any]) -> str:
    """The company report plus an index of assertions grouped by element, site and class."""
    out = [company.render_markdown(pkg), "", "## By element and class", ""]
    for row in pkg["bindings"]:
        ids = ", ".join(f"{x['assertion_id']} ({x['role']})" for x in row["assertions"])
        out.append(f"- `{row['entity']}` [{row['kind']}]: {ids}")
    return "\n".join(out) + "\n"


def to_json(pkg: dict[str, Any]) -> str:
    return json.dumps({"schema_version": SCHEMA_VERSION, "valid_at": pkg["exported_at"], **pkg}, indent=2, ensure_ascii=False) + "\n"


def _safe_cell(v: Any) -> str:
    """Spreadsheet formula-injection guard: a text cell starting with = + - @ gets a leading quote."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def to_csv(pkg: dict[str, Any]) -> str:
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(CSV_COLUMNS)
    for a in pkg["assertions"]:
        trust = a.get("trust") or {}
        row = {
            **a,
            "avoid": " | ".join(a.get("avoid") or []),
            "conditions": " | ".join(c["text"] for c in a.get("conditions") or []),
            "bound_to": " | ".join(f"{b['entity']}:{b['role']}" for b in a.get("bound_to") or []),
            "trust_level": trust.get("level"),
            "stated_by": trust.get("stated_by"),
            "sources": " | ".join(f"{s['source']} {s['file']}" + (f" seq {','.join(map(str, s['seq']))}" if s.get("seq") else "") for s in a.get("sources") or []),
            "conflicts_with": " | ".join(a.get("conflicts_with") or []),
        }
        w.writerow([_safe_cell(row.get(c)) for c in CSV_COLUMNS])
    return out.getvalue()


def to_jsonld(pkg: dict[str, Any]) -> str:
    def ref(entity: str) -> dict[str, str]:
        return {"@id": f"urn:ctx:entity:{entity}"}

    graph: list[dict[str, Any]] = []
    for c in pkg["classes"]:
        graph.append({
            "@id": f"urn:ctx:entity:{c['id']}", "@type": "ctx:ElementClass", "label": c["label"],
            "member": [ref(m) for m in pkg["class_members"].get(c["id"], [])],
        })
    for a in pkg["assertions"]:
        trust = a.get("trust") or {}
        node: dict[str, Any] = {
            "@id": f"urn:ctx:assertion:{a['id']}", "@type": "ctx:Assertion", "assertionType": a["type"],
            "topic": a["topic"], "summary": a["summary"], "validFrom": a["valid_from"], "validTo": a.get("valid_to"),
            "confidence": a["confidence"], "trustLevel": trust.get("level"), "statedBy": trust.get("stated_by"),
            "boundTo": [{"role": b["role"], "entity": ref(b["entity"])} for b in a["bound_to"]],
            "condition": [x["text"] for x in a.get("conditions") or []],
            "diagnosis": a.get("diagnosis"), "action": a.get("action"), "avoid": a.get("avoid") or [], "fact": a.get("fact"),
            "conflictsWith": [{"@id": f"urn:ctx:assertion:{x}"} for x in a.get("conflicts_with") or []],
            "closedBy": {"@id": f"urn:ctx:assertion:{a['closed_by']}"} if a.get("closed_by") else None,
            "source": [{"system": s["source"], "file": s["file"], "seq": s.get("seq") or []} for s in a.get("sources") or []],
        }
        graph.append({k: v for k, v in node.items() if v not in (None, [])})
    context = {
        "ctx": "urn:ctx:vocab:", "label": "http://www.w3.org/2000/01/rdf-schema#label",
        "validFrom": {"@id": "ctx:validFrom", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
        "validTo": {"@id": "ctx:validTo", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
        "confidence": {"@id": "ctx:confidence", "@type": "http://www.w3.org/2001/XMLSchema#decimal"},
        **{k: f"ctx:{k}" for k in ("assertionType", "topic", "summary", "trustLevel", "statedBy", "boundTo", "role", "entity", "condition", "diagnosis", "action", "avoid", "fact", "source", "system", "file", "seq", "member")},
        "conflictsWith": {"@id": "ctx:conflictsWith", "@type": "@id"},
        "closedBy": {"@id": "ctx:closedBy", "@type": "@id"},
    }
    doc = {"@context": context, "@id": "urn:ctx:export", "exported_at": pkg["exported_at"], "@graph": graph}
    doc["@context"]["exported_at"] = "ctx:exportedAt"
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")


def _xml_text(v: Any) -> str:
    if isinstance(v, datetime):
        v = v.isoformat()
    elif isinstance(v, (list, tuple)):
        v = " | ".join(str(x.isoformat() if isinstance(x, datetime) else x) for x in v)
    elif isinstance(v, (dict, set)):
        v = json.dumps(v, default=str, ensure_ascii=False)
    return _XML_BAD.sub("", str(v))


def to_graphml(g, valid_nodes: set[str] | None = None) -> str:
    """A networkx MultiDiGraph as GraphML. `valid_nodes`: assertion ids to keep (None = all)."""
    skip = {n for n, d in g.nodes(data=True) if d.get("kind") == "Assertion" and valid_nodes is not None and n not in valid_nodes}
    nodes = [(n, d) for n, d in g.nodes(data=True) if n not in skip]
    edges = [(u, v, k, d) for u, v, k, d in g.edges(keys=True, data=True) if u not in skip and v not in skip]
    node_keys = sorted({k for _, d in nodes for k in d if k != "payload"})
    edge_keys = sorted({k for *_, d in edges for k in d if k != "type"})
    root = ET.Element("graphml", xmlns="http://graphml.graphdrawing.org/xmlns")
    for scope, keys in (("node", node_keys), ("edge", edge_keys)):
        for k in keys:
            ET.SubElement(root, "key", id=f"{scope[0]}_{k}", **{"for": scope, "attr.name": k, "attr.type": "string"})
    ET.SubElement(root, "key", id="e_type", **{"for": "edge", "attr.name": "type", "attr.type": "string"})
    gr = ET.SubElement(root, "graph", id="knowledge", edgedefault="directed")
    for n, d in nodes:
        el = ET.SubElement(gr, "node", id=_xml_text(n))
        for k in node_keys:
            v = d.get(k)
            if v is None or v == []:
                continue
            text = _xml_text(v)
            ET.SubElement(el, "data", key=f"n_{k}").text = text if k != "text" or len(text) <= 400 else text[:400] + "..."
    for i, (u, v, k, d) in enumerate(edges):
        el = ET.SubElement(gr, "edge", id=f"e{i}", source=_xml_text(u), target=_xml_text(v))
        ET.SubElement(el, "data", key="e_type").text = _xml_text(d.get("type") or k)
        for key in edge_keys:
            if d.get(key) is not None and d.get(key) != []:
                ET.SubElement(el, "data", key=f"e_{key}").text = _xml_text(d[key])
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"


# ---------------------------------------------------------------- routes


def _response(body: str, fmt: str, wb: Dashboard, at: datetime) -> Response:
    info = FORMATS[fmt]
    name = f"knowledge-{at:%Y%m%d}.{info['ext']}"
    return Response(body, media_type=info["media_type"], headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/knowledge/export/formats")
async def export_formats() -> list[dict[str, str]]:
    return [{"format": k, "extension": v["ext"], "media_type": v["media_type"], "description": v["description"]} for k, v in FORMATS.items()]


@router.get("/knowledge/export")
async def knowledge_export(request: Request, format: str = "json", valid_only: bool = True, at: datetime | None = None) -> Response:
    if format not in FORMATS:
        raise HTTPException(422, f"format must be one of {', '.join(FORMATS)}")
    wb = get_wb(request)
    when = at or wb.now()
    if format == "graphml":
        _, kg = _kg(request)
        valid = {n for n, d in kg.g.nodes(data=True) if d.get("kind") == "Assertion" and kg._valid(n, when)} if valid_only else None
        return _response(to_graphml(kg.g, valid), format, wb, when)
    pkg = company.export_package(wb, at=when, valid_only=valid_only)
    body = {
        "json": to_json, "markdown": to_markdown, "csv": to_csv, "jsonld": to_jsonld,
    }[format](pkg)
    return _response(body, format, wb, when)


@router.get("/llm/summary")
async def llm_summary(request: Request) -> LlmSummary:
    return await request.app.state.llm_compactor.summary()


@router.post("/llm/compact")
async def llm_compact_now(request: Request) -> LlmSummary:
    return await request.app.state.llm_compactor.run_once()
