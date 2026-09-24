import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local" });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const orgId = "16500ddb-f325-4a2c-83f1-a28cf2d5f043";

const now = new Date();
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

const to = startOfUtcDay(now);
const from = startOfUtcDay(new Date(now.getTime() - 29 * 86_400_000));
const fromIso = from.toISOString();
const toIso = endOfUtcDay(to).toISOString();

async function main() {
  console.log("Range:", fromIso, "to", toIso);
  const { data, error } = await supabase
    .from("llm_calls")
    .select("created_at, purpose, cost_cents, input_tokens, output_tokens, latency_ms, agent_id")
    .eq("organization_id", orgId)
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: true })
    .limit(50_000);

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Rows count:", data?.length);
    console.log("Last row:", JSON.stringify(data?.[data.length - 1], null, 2));
  }
}

main();
