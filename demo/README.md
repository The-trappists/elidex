# Context Atlas demo

A TypeScript/React frontend prototype for the Elisa Since AI hackathon challenge. It illustrates the intended flow:

1. Capture an expert conversation from a familiar collaboration channel.
2. Extract a machine-readable context assertion with evidence, scope, trust, and validity.
3. Link the assertion to a network entity, a reusable device class, and an agent action.
4. Retrieve the assertion for a similar case—or abstain when the new case falls outside its supported scope.

## Run locally

```bash
cd demo
npm install
npm run dev
```

Use `npm run build` to create a production build in `demo/dist/`.

## Demo data

All records in [`src/data/syntheticScenario.ts`](src/data/syntheticScenario.ts) are synthetic and were generated specifically for this interface. They are deliberately similar in shape to the public Elisa material in `../data/elisa/`, but do not represent an Elisa system, Slack export, customer, person, or real network event.

The interface uses a Slack-style conversation because the UI should be source-adapter neutral. The challenge’s evaluated channels are Teams and email; the same normalized message schema can be fed by a Teams or email adapter.

## Boundaries

This is a static frontend demo. It contains no live Slack integration, LLM call, network action, or fault-detection capability. A backend can later replace `src/data/syntheticScenario.ts` with a typed API that returns validated context assertions and provenance.
