import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local" });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data, error } = await supabase
    .from("llm_calls")
    .select("*")
    .eq("purpose", "agent_turn")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Last 5 rows of agent_turn:", JSON.stringify(data, null, 2));
  }
}

main();
