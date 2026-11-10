# Visitor demo UX review

Reviewed 2026-11-10 against a real local public-demo backend, without credentials or model calls. Browser sizes: 1440 × 1000 and 390 × 844. Exercised conversation → captured rule → TRN-117 guard result; company-day start/pause; network equipment search/selection; knowledge graph; correlations. The scripted case successfully recommended bouncing the interface before rebooting. No horizontal page overflow was observed on the reviewed screens.

## Findings, ordered by impact

### 1. The entry screen does not explain the visitor's task

**Observed:** `/company` opens with a clock, four metrics and a large graph. “Play day” and “Start the SFP case” both use filled blue primary styling. The only explanatory text is “Is the knowledge being used?”; SFP is not explained. A new visitor must choose between two different activities before understanding what either demonstrates. On a 390 px screen, “Knowledge in force” is truncated.

**Correction:** Give the visitor a short, inline explanation of the prepared story: an optical-module replacement on TRN-042, Erkki's captured advice, and its reuse on TRN-117. Make the guided case the sole primary entry action; keep company simulation a clearly secondary, fully working action. Use a compact evidence path, not a marketing hero or onboarding modal. Keep metric labels readable on phones. Once simulation is running, its pause/resume control must remain easy to find.

### 2. A prepared walkthrough opens a developer-style agent form

**Observed:** Step 3 shows “Agent tester”, an entity selector, unrelated presets, a disabled “Use LLM” switch, Reset, a large editable description and a collapsed “Observations and planned action 6” control. The crucial planned reboot is hidden. At 390 px the form occupies roughly half the screen; after running, the result starts below it and “Finish” appears above the evidence. The empty-state instructions tell visitors to choose an entity and describe an event even though the case is already prepared.

**Correction:** In the public SFP walkthrough only, show a concise, readable prepared-case summary: TRN-117, observed symptoms, and “Planned action: Reboot TRN-117”, with one “Run SFP case” action. Keep experimental editing behind an explicit disclosure; retain the complete tester outside this walkthrough. Keep the scripted walkthrough independent of live-provider settings. On success, bring the recommendation into view/focus without forcing motion; retain readable evidence and a clear continuation. Use task language rather than implementation jargon.

### 3. The knowledge graph hides the knowledge in its own browser

**Observed:** `/graph` labels its sidebar “Knowledge” but lists all 20 equipment entries before the assertions. The actual rules are far below the first viewport. On the canvas, assertion summaries are reduced to short truncated labels; they cannot substitute for a readable list. Public navigation is 13 px, walkthrough instructions/buttons 12 px, and the phone step label drops to 8 px. This is unnecessarily small for a demo viewed in a room or on a phone.

**Correction:** In the public graph, list captured knowledge first, then other object types, with an accurate sidebar heading. Preserve search, selection, graph relationships and the always-visible timeline. Make public navigation, walkthrough guidance and primary actions at least 14 px; utility metadata at least 11–12 px. Preserve the existing high-contrast ink/muted text and blue accent instead of adding decorative colors. Do not globally enlarge dense technical screens or distort the graph physics.

## Recommended implementation direction

This is a focused refinement of the team's logged light-only design, not a new identity or product decision. It stays in scope: show human knowledge captured, linked and reused; do not add network diagnosis or extra specialist work.

- **Subject / audience / job:** network specialists and demo visitors following one colleague's advice from its source to a safer agent plan.
- **Palette:** Paper `#f6f8fb`, Surface `#ffffff`, Ink `#171c43`, Muted `#5a6478`, Elisa blue `#006aed`, Verified green `#0c6b35`. Reuse existing semantic warning/error tokens where their meaning requires them. Blue only denotes action/selection, green verified/successful state.
- **Typography:** retain Space Grotesk for restrained headings, Public Sans for readable task text, JetBrains Mono for equipment IDs and time. Body/action text 14–16 px; small metadata 11–12 px, never the 8 px walkthrough label.
- **Layout option A (recommended):** compact inline story above the company controls; no additional screen. The existing graph remains the main workspace.
- **Layout option B:** onboarding dialog. Rejected for this pass: blocks exploration, duplicates content and adds dismissal state.
- **Signature:** an evidence path `TRN-042 conversation → captured rule → TRN-117 advice`. This is a real sequence, not decorative numbering.

```text
[Public navigation]
[Conversation: TRN-042 → Captured rule → Safer plan: TRN-117] [Start case]
[Company day: status / time / secondary simulation controls]
[Metrics]
[Knowledge map]
[Latest advice | Network status]
```

**Plan critique:** a larger generic dashboard hero would add ceremony without explaining this product. Use the actual source-to-rule-to-action path instead. Keep the existing font pairing and palette; the risk is making evidence, rather than metrics, the visitor's first visual anchor. No gradients, ornamental cards, new type dependencies or ambient animation are needed.

## Acceptance checks

- Complete the three-step source → rule → agent path without keys; TRN-117 still receives bounce-first advice and an adapted reboot plan.
- Company simulation still starts, pauses and resumes.
- Knowledge graph initially exposes assertions before equipment; searching and selecting TRN-117 still works.
- Inspect at 390 × 844, 1280 × 600 and desktop: no page-level horizontal overflow, readable labels, usable main content, visible keyboard focus and reduced-motion-safe result navigation.
- Run the frontend build once after implementation, then inspect the actual changed surfaces in the browser. No live provider/Slack checks or credential access.

## Baseline checks

The palette already has sufficient contrast for normal-sized text; the correction is hierarchy and size, not a new color system. Calculated from the existing sRGB tokens:

| Text / background | Contrast ratio |
| --- | --- |
| Ink / paper | 15.38:1 |
| Muted / paper | 5.59:1 |
| White / Elisa blue | 4.90:1 |
| Verified green / white | 6.62:1 |

The mobile navigation opens, closes with Escape and restores focus to its trigger. The existing font assets loaded in the browser. The marketing homepage and Connections remain separate from the prepared walkthrough; no credential submission was attempted.

The scripted company day also completed end to end: 10 of 10 conversations, six captured knowledge items and four agent calls. Its advice included the synthetic harbour-hut breaker workaround; cases without applicable human knowledge explicitly fell back to the standard procedure.

## Verification after fixes

- Sub-agent implemented the three findings and updated `docs/public-demo.md`.
- TypeScript project build and production Vite build passed. Vite reported an 880.24 kB JavaScript chunk and its standard >500 kB warning; bundle splitting was not part of this UX pass.
- Real-browser checks covered 390 × 844, 1024 × 600, 1280 × 600 and desktop. No page-level horizontal overflow on the changed surfaces. The company canvas retained 322 px height at both short laptop widths.
- Public navigation/actions/instructions measure 14 px; walkthrough metadata measures 11 px. Mobile metric labels wrap instead of truncating.
- Source → captured rule → TRN-117 still returns bounce-first advice and an adapted reboot plan. Optional case editing and the finish continuation work.
- Keyboard activation focuses the recommendation with a visible outline; the phone check used reduced motion. Company simulation start/pause/resume works with the new control layout.
- The graph now exposes readable knowledge first; searching/selecting TRN-117 still opens its equipment and class connections. Its timeline remains visible.
- The built production app passed the phone guided case and the unchanged team tester. Both production browser tabs reported no runtime errors. No live model or Slack call was made.
