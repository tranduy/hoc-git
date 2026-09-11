import type {FootballCollectionPlan,ProviderId} from "@tool-chenh/contracts";

/** Acquisition hints are independent of price evidence and never update catalogs. */
export class FootballCollectionPlanPublisher {
  // Attempts bound retries; only a successful HTTP response clears delivery errors.
  readonly #attempts = new Map<ProviderId,{signature:string;atMs:number}>();
  readonly #inFlight = new Set<ProviderId>();
  readonly #errors = new Map<ProviderId,string>();
  #revision = 0;
  constructor(readonly fetcher:typeof fetch) {}
  lastError(provider:ProviderId):string|null {return this.#errors.get(provider) ?? null;}
  async publish(plans:ReadonlyMap<ProviderId,FootballCollectionPlan>,nowMs:number):Promise<void> {
    await Promise.all([...plans].map(async ([provider,plan]) => {
      const signature = JSON.stringify(plan.events);
      const previous = this.#attempts.get(provider);
      if (this.#inFlight.has(provider) || previous?.signature === signature && nowMs-previous.atMs < 30000) return;
      this.#attempts.set(provider,{signature,atMs:nowMs});
      this.#inFlight.add(provider);
      this.#revision = Math.max(this.#revision + 1,plan.revision,nowMs);
      const outgoingPlan = {...plan,revision:this.#revision};
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(),5000);
      try {
        const response=await this.fetcher("/api/chrome-bridge/collection-plan",{method:"POST",cache:"no-store",
          headers:{"content-type":"application/json"},body:JSON.stringify({provider,plan:outgoingPlan}),signal:controller.signal});
        if (!response.ok) this.#errors.set(provider,`HTTP ${response.status}`);
        else this.#errors.delete(provider);
      } catch { this.#errors.set(provider,"NETWORK_UNAVAILABLE"); }
      finally { clearTimeout(timer); this.#inFlight.delete(provider); }
    }));
  }
}
