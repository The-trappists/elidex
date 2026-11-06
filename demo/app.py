"""Demo UI. Run: uv run streamlit run demo/app.py"""

import json

import streamlit as st

from context_layer.agent import load_cases, run_agent
from context_layer.listen import discover_threads
from context_layer.pipeline import build_store

st.set_page_config(page_title="Context layer", layout="wide")
st.title("Context layer: what the humans know")
st.caption("Teams and email in, context assertions bound to network entities out, reused by an agent.")

with st.sidebar:
    st.header("MVP angles")
    lifecycle = st.toggle("D · Lifecycle (later messages close validity)", value=False)
    use_conditions = st.toggle("C · Conditional rules", value=False)
    use_guard = st.toggle("B · Ask-before-act guard", value=False)


@st.cache_resource
def get_store(lifecycle: bool):
    return build_store(lifecycle=lifecycle)


store, report = get_store(lifecycle)
capture, link, reuse = st.tabs(["1 · Capture", "2 · Link & store", "3 · Reuse"])

with capture:
    st.write("Nobody types anything: these are the messages as they were sent.")
    for thread in discover_threads():
        with st.expander(f"{thread.source} · {thread.id} · {thread.subject or ''}"):
            for m in thread.messages:
                st.markdown(f"**[{m.seq}] {m.author}** _{m.role or ''}_ · {m.sent_at:%Y-%m-%d %H:%M}  \n{m.text}")

with link:
    c1, c2, c3 = st.columns(3)
    c1.metric("Threads", len(report.threads))
    c2.metric("Assertions", len(store.assertions))
    c3.metric("Merged across channels", report.merged)
    for line in report.events:
        st.info(line)
    for line in report.notes:
        st.caption(line)
    for a in store.assertions.values():
        with st.expander(f"{a.id} · {a.type} · {a.topic}" + (" · closed" if a.valid_to else "")):
            st.json(json.loads(a.model_dump_json()))

with reuse:
    cases = load_cases()
    case = st.selectbox("Case", cases, format_func=lambda c: f"{c.id}: {c.title}")
    st.write(f"**{case.entity_id}** at {case.at:%Y-%m-%d %H:%M}: {case.description}")
    if case.observations:
        st.caption(f"Observations: {case.observations}")
    r = run_agent(store, case, use_conditions=use_conditions, use_guard=use_guard)
    st.code(r.recommendation, language=None)
    for hit, why in r.skipped:
        st.warning(f"Not applied: {hit.assertion.id} ({why})")
    if r.verdict:
        box = st.success if r.verdict.decision == "go" else st.warning
        box(f"Guard on '{r.verdict.action}': {r.verdict.decision.upper()}")
        st.markdown("\n".join(f"{i}. {s}" for i, s in enumerate(r.verdict.steps, 1)))
        for reason in r.verdict.reasons:
            st.caption(reason)
