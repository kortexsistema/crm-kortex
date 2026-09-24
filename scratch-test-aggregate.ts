import { aggregateUsage } from "./lib/ai/usage/aggregate";

const rows = [
  {
    created_at: "2026-09-24T14:36:52.666203+00:00",
    invocation_kind: "agent_turn",
    cost_cents: null,
    prompt_tokens: 46122,
    completion_tokens: 300,
    total_tokens: 46422,
    latency_ms: 16820
  }
];

const dailyInbounds = new Map();
const dailyHandoffs = new Map();
const range = {
  from: new Date("2026-08-26T00:00:00.000Z"),
  to: new Date("2026-09-24T00:00:00.000Z")
};

const res = aggregateUsage(rows, dailyInbounds, dailyHandoffs, range);
console.log(JSON.stringify(res, null, 2));
