import { createClient, type Session } from "@supabase/supabase-js";
import { Preferences } from "@capacitor/preferences";
import {
  classifyIdentifier,
  normalizeBranchUsername,
  safeAuthMessage,
  validateBranchUsername,
} from "./authContract";

export type AuthRole = "owner" | "branch";
export interface MobileProfile {
  id: string;
  role: AuthRole;
  tenantId: string;
  branchId: string | null;
  fullName: string;
  active: boolean;
  branchName?: string;
}

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const appEnvironment = import.meta.env.VITE_APP_ENV;
export const authConfigured = Boolean(url && key && appEnvironment);
export const configurationError = authConfigured
  ? ""
  : "Required public mobile configuration is missing.";
const nativeStorage = {
  async getItem(key: string) {
    return (await Preferences.get({ key })).value;
  },
  async setItem(key: string, value: string) {
    await Preferences.set({ key, value });
  },
  async removeItem(key: string) {
    await Preferences.remove({ key });
  },
};
export const supabase = authConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "kubri-mobile-auth-v1",
        storage: nativeStorage,
      },
    })
  : null;

export async function signIn(
  identifier: string,
  password: string,
): Promise<MobileProfile> {
  if (!supabase)
    throw new Error("Mobile authentication is not configured for this build.");
  const startedAt = performance.now();
  const kind = classifyIdentifier(identifier);
  let email = identifier.trim();
  if (kind === "branch-username") {
    const resolverStartedAt = performance.now();
    const username = normalizeBranchUsername(email);
    const validationError = validateBranchUsername(username);
    if (validationError) throw new Error(validationError);
    const { data, error } = await supabase.functions.invoke(
      "resolve-branch-username",
      {
        body: { username },
      },
    );
    if (error) {
      const diagnosticCategory = /fetch|network|offline|connection/i.test(
        error.message,
      )
        ? "network"
        : "resolver-unavailable";
      console.info(
        `[Kubri Mobile Auth] identifier=branch-username resolver=failed category=${diagnosticCategory}`,
      );
      throw new Error(safeAuthMessage(diagnosticCategory));
    }
    if (data?.ok !== true || typeof data.authEmail !== "string") {
      console.info(
        "[Kubri Mobile Auth] identifier=branch-username resolver=not-resolved",
      );
      throw new Error(safeAuthMessage("username-not-found"));
    }
    console.info(
      "[Kubri Mobile Auth] identifier=branch-username resolver=resolved mapped-email=true",
    );
    console.info(
      `[Kubri Mobile Timing] username_resolution_ms=${Math.round(performance.now() - resolverStartedAt)}`,
    );
    email = data.authEmail;
  }
  const authStartedAt = performance.now();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    console.info(
      `[Kubri Mobile Auth] identifier=${kind} auth=rejected category=invalid-credentials`,
    );
    throw new Error(
      safeAuthMessage(
        kind === "branch-username" ? "invalid-password" : "email-credentials",
      ),
    );
  }
  console.info(
    `[Kubri Mobile Timing] sign_in_request_ms=${Math.round(performance.now() - authStartedAt)}`,
  );
  try {
    const profileStartedAt = performance.now();
    const profile = await loadProfile(data.session);
    console.info(
      `[Kubri Mobile Timing] profile_scope_validation_ms=${Math.round(performance.now() - profileStartedAt)}`,
    );
    console.info(
      `[Kubri Mobile Timing] authentication_total_ms=${Math.round(performance.now() - startedAt)}`,
    );
    console.info(
      `[Kubri Mobile Auth] identifier=${kind} auth=accepted profile=resolved role=${profile.role}`,
    );
    return profile;
  } catch (profileError) {
    await supabase.auth.signOut({ scope: "local" });
    throw profileError;
  }
}

export async function loadProfile(session: Session): Promise<MobileProfile> {
  if (!supabase) throw new Error("Authentication is unavailable.");
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id,tenant_id,branch_id,role,full_name,is_active")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error || !data) throw new Error("We could not verify this account.");
  if (data.is_active === false) throw new Error("This account is not active.");
  if (data.role === "super_admin")
    throw new Error("Super Admin accounts must use the Kubri web workspace.");
  if (data.role !== "owner" && data.role !== "branch")
    throw new Error("This account type is unavailable on mobile.");
  if (!data.tenant_id)
    throw new Error("This account is not linked to a business.");
  const [tenantResult, accessResult, branchResult] = await Promise.all([
    supabase
      .from("tenants")
      .select("is_active,suspended_at")
      .eq("id", data.tenant_id)
      .maybeSingle(),
    supabase.rpc("get_tenant_subscription_access", {
      p_tenant_id: data.tenant_id,
    }),
    data.role === "branch" && data.branch_id
      ? supabase
          .from("branches")
          .select("name,is_active")
          .eq("id", data.branch_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const tenant = tenantResult.data;
  if (!tenant?.is_active || tenant.suspended_at)
    throw new Error(
      "This business account is suspended. Contact Kubri support.",
    );
  const { data: access, error: accessError } = accessResult;
  const accessRow = Array.isArray(access) ? access[0] : access;
  if (accessError || (accessRow && accessRow.has_access === false))
    throw new Error(
      "This subscription does not currently allow workspace access.",
    );
  let branchName: string | undefined;
  if (data.role === "branch") {
    if (!data.branch_id)
      throw new Error("Branch access could not be verified.");
    const branch = branchResult.data;
    if (!branch?.is_active) throw new Error("This branch is not active.");
    branchName = branch.name;
  }
  return {
    id: data.id,
    role: data.role,
    tenantId: data.tenant_id,
    branchId: data.branch_id,
    fullName: data.full_name || "Kubri user",
    active: true,
    branchName,
  };
}

export async function restoreSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    if (error) await supabase.auth.signOut({ scope: "local" });
    return null;
  }
  return loadProfile(data.session);
}

export async function signOut() {
  await supabase?.auth.signOut();
  await Preferences.remove({ key: "kubri-mobile-auth-v1" });
}
