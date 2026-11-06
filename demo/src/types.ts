export type TrustLevel = "hunch" | "stated" | "verified";

export type ConversationMessage = {
  id: string;
  time: string;
  author: string;
  role: string;
  text: string;
  evidence?: boolean;
  outcome?: boolean;
};

export type ContextAssertion = {
  id: string;
  type: "workaround" | "access" | "configuration";
  appliesTo: string;
  observedOn: string;
  trigger: string;
  conditions: string[];
  action: string;
  avoid: string[];
  validFrom: string;
  validTo: string | null;
  trust: TrustLevel;
  confidence: number;
  sources: string[];
};

export type NetworkCase = {
  id: string;
  title: string;
  description: string;
  model: string;
  installYear: number;
  event: string;
  conditions: string[];
};
