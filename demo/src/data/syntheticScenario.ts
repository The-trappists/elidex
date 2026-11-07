import type { ContextAssertion, ConversationMessage, NetworkCase } from "../types";

/**
 * Entirely synthetic, Slack-shaped data generated for the hackathon UI.
 * It deliberately resembles the public Elisa example without representing
 * a real Slack export, person, network, or customer record.
 */
export const syntheticConversation: ConversationMessage[] = [
  {
    id: "msg-001",
    time: "10:02",
    author: "Maya R.",
    role: "Field engineer",
    text: "At TRN-117. I changed the optical module and the alarms are clear, but customer traffic has not returned.",
  },
  {
    id: "msg-002",
    time: "10:04",
    author: "Jonas K.",
    role: "Network specialist",
    text: "Is TRN-117 one of the T-880 units from around 2019?",
    evidence: true,
  },
  {
    id: "msg-003",
    time: "10:04",
    author: "Maya R.",
    role: "Field engineer",
    text: "Yes — inventory lists model T-880, installed in 2019.",
    evidence: true,
  },
  {
    id: "msg-004",
    time: "10:06",
    author: "Jonas K.",
    role: "Network specialist",
    text: "On those units, a green link after an optical-module swap is not enough. The forwarding state can stay stuck even when optics look fine.",
    evidence: true,
  },
  {
    id: "msg-005",
    time: "10:08",
    author: "Maya R.",
    role: "Field engineer",
    text: "Interface is UP, RX power is normal and the traffic counters are still at zero.",
    evidence: true,
  },
  {
    id: "msg-006",
    time: "10:09",
    author: "Jonas K.",
    role: "Network specialist",
    text: "That matches it. Disable the interface, wait briefly, then enable it. Do not replace the module again or reboot unless the interface bounce fails.",
    evidence: true,
  },
  {
    id: "msg-007",
    time: "10:13",
    author: "Maya R.",
    role: "Field engineer",
    text: "Bounced it. Counters are moving and traffic is back.",
    evidence: true,
    outcome: true,
  },
  {
    id: "msg-008",
    time: "10:14",
    author: "Jonas K.",
    role: "Network specialist",
    text: "Good — worth retaining as context for the older T-880s.",
    evidence: true,
  },
];

export const supportingEmail = {
  from: "Jonas K. <jonas.k@example.invalid>",
  subject: "RE: TRN-117 traffic after optical module swap",
  body:
    "For older T-880 units, interface UP and normal optical readings can coexist with zero traffic after an optical-module swap. Check the counters and bounce the interface before another swap or reboot. We have seen this recover traffic more than once.",
};

export const assertion: ContextAssertion = {
  id: "ctx-2019-forwarding-recovery",
  type: "workaround",
  appliesTo: "T-880 transmission units installed 2018–2020",
  observedOn: "TRN-117",
  trigger: "optical module replacement",
  conditions: [
    "Interface is UP",
    "Optical levels are normal",
    "Traffic counters remain at zero",
  ],
  action: "Disable the interface, wait briefly, then enable it again.",
  avoid: ["Replace the optical module again", "Reboot before the interface bounce fails"],
  validFrom: "2026-11-06T10:13:00+02:00",
  validTo: null,
  trust: "verified",
  confidence: 0.92,
  sources: ["#field-operations · msgs 002–008", "Synthetic follow-up email"],
};

export const cases: Record<"similar" | "different", NetworkCase> = {
  similar: {
    id: "TRN-204",
    title: "Similar case · TRN-204",
    description: "A field engineer asks for the safest next step after an optical module replacement.",
    model: "T-880",
    installYear: 2019,
    event: "Optical module replacement",
    conditions: ["Interface UP", "Optical levels normal", "Traffic counters zero"],
  },
  different: {
    id: "TRN-305",
    title: "Non-matching case · TRN-305",
    description: "Same symptoms are reported, but the unit is outside the supported class.",
    model: "T-980",
    installYear: 2024,
    event: "Optical module replacement",
    conditions: ["Interface UP", "Optical levels normal", "Traffic counters zero"],
  },
};
