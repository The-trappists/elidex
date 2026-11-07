import { useState } from "react";
import { assertion, cases, supportingEmail, syntheticConversation } from "./data/syntheticScenario";

type SourceView = "conversation" | "email";
type CaseKind = "similar" | "different";

const stages = ["Capture", "Extract", "Link", "Reuse"];

function TrustBadge() {
  return (
    <span className="badge badge-verified" title="An outcome in the conversation supports this assertion">
      <span aria-hidden="true">●</span> Verified outcome
    </span>
  );
}

function GraphNode({
  x,
  y,
  label,
  detail,
  kind,
}: {
  x: number;
  y: number;
  label: string;
  detail: string;
  kind: "entity" | "assertion" | "source" | "action";
}) {
  return (
    <g className={`graph-node graph-node-${kind}`} transform={`translate(${x} ${y})`}>
      <rect width="174" height="54" rx="10" />
      <text x="14" y="22" className="graph-node-label">
        {label}
      </text>
      <text x="14" y="40" className="graph-node-detail">
        {detail}
      </text>
    </g>
  );
}

function App() {
  const [sourceView, setSourceView] = useState<SourceView>("conversation");
  const [selectedMessage, setSelectedMessage] = useState("msg-006");
  const [stage, setStage] = useState(3);
  const [caseKind, setCaseKind] = useState<CaseKind>("similar");
  const [hasRunContext, setHasRunContext] = useState(false);

  const currentCase = cases[caseKind];
  const isApplicable = caseKind === "similar";

  function replayCapture() {
    setStage(0);
    setHasRunContext(false);
    window.setTimeout(() => setStage(1), 380);
    window.setTimeout(() => setStage(2), 780);
    window.setTimeout(() => setStage(3), 1180);
  }

  function changeCase(nextCase: CaseKind) {
    setCaseKind(nextCase);
    setHasRunContext(false);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Context Atlas home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Context Atlas</span>
        </a>
        <div className="header-meta">
          <span className="synthetic-chip">Synthetic demo data</span>
          <span className="header-divider" />
          <span>Human context for network agents</span>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">CAPTURE → LINK → REUSE</p>
          <h1>Turn one expert conversation into context an agent can safely reuse.</h1>
          <p className="hero-copy">
            This prototype extracts a verified workaround from a Slack-style field conversation,
            links it to the right network context, and checks whether it applies to a new case.
          </p>
        </div>
        <button className="outline-button" onClick={replayCapture} type="button">
          <span aria-hidden="true">↻</span> Replay capture
        </button>
      </section>

      <nav className="pipeline" aria-label="Demo pipeline">
        {stages.map((item, index) => (
          <div className={`pipeline-step ${index <= stage ? "complete" : ""}`} key={item}>
            <span className="step-number">{index < stage ? "✓" : index + 1}</span>
            <span>{item}</span>
            {index < stages.length - 1 && <span className="pipeline-line" aria-hidden="true" />}
          </div>
        ))}
      </nav>

      <section className="notice" aria-label="Demo boundary">
        <span aria-hidden="true">✦</span>
        <p>
          All names, identifiers, messages, and email content in this interface are generated
          synthetic data. This demonstrates captured human context; it does not control or diagnose a network.
        </p>
      </section>

      <section className="workspace" aria-label="Context capture and graph">
        <article className="panel source-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">1 · INPUT</p>
              <h2>Conversation evidence</h2>
            </div>
            <span className="source-count">{syntheticConversation.length} messages</span>
          </div>

          <div className="tabs" role="tablist" aria-label="Synthetic source material">
            <button
              className={sourceView === "conversation" ? "tab active" : "tab"}
              onClick={() => setSourceView("conversation")}
              role="tab"
              aria-selected={sourceView === "conversation"}
              type="button"
            >
              <span aria-hidden="true">#</span> field-operations
            </button>
            <button
              className={sourceView === "email" ? "tab active" : "tab"}
              onClick={() => setSourceView("email")}
              role="tab"
              aria-selected={sourceView === "email"}
              type="button"
            >
              <span aria-hidden="true">✉</span> Follow-up email
            </button>
          </div>

          {sourceView === "conversation" ? (
            <div className="messages" aria-label="Synthetic Slack-style messages">
              {syntheticConversation.map((message) => (
                <button
                  className={`message ${message.evidence ? "evidence" : ""} ${
                    selectedMessage === message.id ? "selected" : ""
                  }`}
                  key={message.id}
                  onClick={() => setSelectedMessage(message.id)}
                  type="button"
                >
                  <span className="avatar" aria-hidden="true">
                    {message.author
                      .split(" ")
                      .map((part) => part[0])
                      .join("")}
                  </span>
                  <span className="message-body">
                    <span className="message-head">
                      <strong>{message.author}</strong>
                      <span>{message.role}</span>
                      <time>{message.time}</time>
                      {message.outcome && <span className="outcome-dot" title="Observed outcome" />}
                    </span>
                    <span className="message-text">{message.text}</span>
                    {message.evidence && <span className="evidence-label">Used as evidence</span>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="email-view">
              <span className="email-label">Synthetic supporting source</span>
              <h3>{supportingEmail.subject}</h3>
              <p className="email-from">From: {supportingEmail.from}</p>
              <p>{supportingEmail.body}</p>
              <div className="email-source-note">
                <span aria-hidden="true">↗</span> Corroborates the proposed action; it does not replace the original conversation evidence.
              </div>
            </div>
          )}
        </article>

        <article className="panel assertion-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">2 · EXTRACTED CONTEXT</p>
              <h2>Forwarding recovery workaround</h2>
            </div>
            <TrustBadge />
          </div>

          <p className="assertion-intro">
            A conditional, machine-readable assertion rather than a chat summary.
          </p>

          <div className="scope-card">
            <span className="scope-icon" aria-hidden="true">◌</span>
            <div>
              <span className="field-label">Applies to</span>
              <strong>{assertion.appliesTo}</strong>
              <span className="field-hint">Observed on {assertion.observedOn}</span>
            </div>
          </div>

          <div className="conditions-block">
            <span className="field-label">Only when all conditions match</span>
            <div className="condition-list">
              {assertion.conditions.map((condition) => (
                <span className="condition" key={condition}>
                  <span aria-hidden="true">✓</span> {condition}
                </span>
              ))}
            </div>
          </div>

          <div className="action-card">
            <span className="field-label">Recommended action</span>
            <p>{assertion.action}</p>
          </div>

          <div className="avoid-block">
            <span className="field-label">Avoid first</span>
            <ul>
              {assertion.avoid.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="assertion-footer">
            <div>
              <span className="field-label">Validity</span>
              <span>From 06 Nov 2026 · still believed true</span>
            </div>
            <div>
              <span className="field-label">Extraction confidence</span>
              <span>{Math.round(assertion.confidence * 100)}%</span>
            </div>
          </div>
        </article>
      </section>

      <section className="lower-grid" aria-label="Knowledge graph and agent reuse">
        <article className="panel graph-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">3 · LINKED CONTEXT</p>
              <h2>Context knowledge graph</h2>
            </div>
            <span className="legend"><i className="legend-entity" /> Entity <i className="legend-assertion" /> Assertion</span>
          </div>

          <div className="graph-shell">
            <svg viewBox="0 0 760 288" role="img" aria-label="Knowledge graph linking a workaround to a device class, source evidence and action">
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="currentColor" />
                </marker>
              </defs>
              <g className="graph-edges" markerEnd="url(#arrow)">
                <path d="M184 78 C220 78 224 124 270 124" />
                <path d="M184 212 C224 212 231 174 270 170" />
                <path d="M444 144 C476 144 486 78 530 78" />
                <path d="M444 160 C480 165 486 213 530 213" />
              </g>
              <g className="graph-edge-labels">
                <text x="204" y="102">applies to</text>
                <text x="198" y="197">supported by</text>
                <text x="468" y="102">observed on</text>
                <text x="470" y="201">recommends</text>
              </g>
              <GraphNode x={10} y={50} label="Device class" detail="T-880 · 2018–2020" kind="entity" />
              <GraphNode x={10} y={185} label="Source evidence" detail="#field-operations" kind="source" />
              <GraphNode x={270} y={116} label="Context assertion" detail="ctx-2019-forwarding" kind="assertion" />
              <GraphNode x={530} y={50} label="Observed node" detail="TRN-117" kind="entity" />
              <GraphNode x={530} y={185} label="Agent action" detail="Bounce interface" kind="action" />
            </svg>
          </div>
          <p className="graph-caption">
            The instance is evidence; the device class defines safe reuse. If the class cannot be linked confidently, the system should abstain.
          </p>
        </article>

        <article className="panel agent-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">4 · AGENT REUSE</p>
              <h2>Check a new case</h2>
            </div>
            <span className="agent-ready"><span /> Context tool ready</span>
          </div>

          <div className="case-switch" role="group" aria-label="Choose a synthetic new case">
            <button className={caseKind === "similar" ? "active" : ""} onClick={() => changeCase("similar")} type="button">
              Matching unit
            </button>
            <button className={caseKind === "different" ? "active" : ""} onClick={() => changeCase("different")} type="button">
              Different unit
            </button>
          </div>

          <div className="case-card">
            <div className="case-heading">
              <span className="case-icon" aria-hidden="true">⌁</span>
              <div>
                <h3>{currentCase.title}</h3>
                <p>{currentCase.description}</p>
              </div>
            </div>
            <dl className="case-facts">
              <div><dt>Model</dt><dd>{currentCase.model}</dd></div>
              <div><dt>Installed</dt><dd>{currentCase.installYear}</dd></div>
              <div><dt>Event</dt><dd>{currentCase.event}</dd></div>
            </dl>
            <div className="case-conditions">
              {currentCase.conditions.map((condition) => <span key={condition}>{condition}</span>)}
            </div>
          </div>

          <button className="run-button" onClick={() => setHasRunContext(true)} type="button">
            <span aria-hidden="true">⌘</span> Check human context
          </button>

          {hasRunContext ? (
            <div className={`agent-result ${isApplicable ? "matches" : "abstains"}`}>
              <div className="result-heading">
                <span className="result-icon" aria-hidden="true">{isApplicable ? "✓" : "!"}</span>
                <div>
                  <span>{isApplicable ? "Applicable verified context found" : "No safe match — abstain"}</span>
                  <strong>{isApplicable ? "Adapt the planned action" : "Do not apply the workaround"}</strong>
                </div>
              </div>
              {isApplicable ? (
                <p>
                  Check counters, then bounce the interface before a module replacement or reboot. The node matches the T-880 2018–2020 class and all three conditions.
                </p>
              ) : (
                <p>
                  The symptoms match, but TRN-305 is a 2024 T-980. The evidence supports a narrower class only, so the agent returns the gap instead of overgeneralising.
                </p>
              )}
              <span className="result-citation">Evidence: #field-operations · msgs 002–008</span>
            </div>
          ) : (
            <div className="result-placeholder">Run a context check to see a traceable recommendation or a safe abstention.</div>
          )}
        </article>
      </section>

      <footer>
        <span>Context Atlas · hackathon prototype</span>
        <span>All displayed operational data is synthetic.</span>
      </footer>
    </main>
  );
}

export default App;
