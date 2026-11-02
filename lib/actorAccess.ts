import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import {
  CAPABILITY_DENIED,
  capabilitiesFor,
  hasCapability,
  type Capability,
  type CapabilityInput,
} from "@/lib/capabilities";
import { sessionUser } from "@/lib/sessionUser";

export type ActorAccess = CapabilityInput & {
  id: string | null;
};

export async function currentActor(): Promise<ActorAccess> {
  if (!authRequired()) {
    return { id: null, role: null, status: "approved", pricingOfficer: false, authOn: false };
  }
  const session = await sessionUser();
  if (!session) return { id: null, role: null, status: null, pricingOfficer: false, authOn: true };
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") {
    return {
      id: user?.id ?? session.id,
      role: user?.role ?? null,
      status: user?.status ?? null,
      pricingOfficer: Boolean(user?.pricing_officer),
      authOn: true,
    };
  }
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    pricingOfficer: user.pricing_officer,
    authOn: true,
  };
}

export async function actorCan(capability: Capability): Promise<boolean> {
  const actor = await currentActor();
  return hasCapability(capabilitiesFor(actor), capability);
}

export async function requireCapability(capability: Capability): Promise<ActorAccess> {
  if (!authRequired()) return currentActor();
  const session = await sessionUser();
  if (!session) throw new Error("Sign in required.");
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") throw new Error("This account cannot change data.");
  const actor: ActorAccess = {
    id: user.id,
    role: user.role,
    status: user.status,
    pricingOfficer: user.pricing_officer,
    authOn: true,
  };
  if (!hasCapability(capabilitiesFor(actor), capability)) {
    throw new Error(CAPABILITY_DENIED[capability]);
  }
  return actor;
}
