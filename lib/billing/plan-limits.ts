import { createServerClient } from "@/lib/supabase/server";

export type PlanType = "standard" | "pro" | "enterprise";

export interface PlanLimits {
  maxUsers: number | "unlimited";
  maxConnections: number | "unlimited";
  maxAgents: number | "unlimited";
  maxIntegrations: number | "unlimited";
  features: {
    agenda: boolean;
    metaAds: boolean;
    customBranding: boolean;
    products: boolean;
  };
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  standard: {
    maxUsers: 1,
    maxConnections: 1,
    maxAgents: 1,
    maxIntegrations: 0,
    features: {
      agenda: false,
      metaAds: false,
      customBranding: false,
      products: false,
    },
  },
  pro: {
    maxUsers: 5,
    maxConnections: 2,
    maxAgents: 4,
    maxIntegrations: 2,
    features: {
      agenda: true,
      metaAds: false,
      customBranding: false,
      products: false,
    },
  },
  enterprise: {
    maxUsers: "unlimited",
    maxConnections: "unlimited",
    maxAgents: "unlimited",
    maxIntegrations: "unlimited",
    features: {
      agenda: true,
      metaAds: true,
      customBranding: true,
      products: true,
    },
  },
};

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  const normalizedPlan = (plan?.toLowerCase() as PlanType) || "standard";
  return PLAN_LIMITS[normalizedPlan] || PLAN_LIMITS.standard;
}

export async function validatePlanLimit(
  organizationId: string,
  resourceType: "users" | "connections" | "agents" | "integrations"
): Promise<{ allowed: boolean; limit: number | "unlimited"; currentCount: number }> {
  const supabase = createServerClient();
  
  const { data: org } = await supabase
    .from("organizations")
    .select("plan")
    .eq("id", organizationId)
    .single();

  const limits = getPlanLimits(org?.plan);
  let maxAllowed: number | "unlimited";

  switch (resourceType) {
    case "users":
      maxAllowed = limits.maxUsers;
      break;
    case "connections":
      maxAllowed = limits.maxConnections;
      break;
    case "agents":
      maxAllowed = limits.maxAgents;
      break;
    case "integrations":
      maxAllowed = limits.maxIntegrations;
      break;
  }

  if (maxAllowed === "unlimited") {
    return { allowed: true, limit: "unlimited", currentCount: 0 };
  }


  let currentCount = 0;

  switch (resourceType) {
    case "users": {
      const { count } = await supabase
        .from("organization_members")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId);
      currentCount = count || 0;
      break;
    }
    case "connections": {
      const { count } = await supabase
        .from("whatsapp_sessions")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId);
      currentCount = count || 0;
      break;
    }
    case "agents": {
      const { count } = await supabase
        .from("agents")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId);
      currentCount = count || 0;
      break;
    }
    case "integrations": {
      const { count } = await supabase
        .from("tenant_integrations")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId);
      currentCount = count || 0;
      break;
    }
  }

  return {
    allowed: currentCount < maxAllowed,
    limit: maxAllowed,
    currentCount,
  };
}
