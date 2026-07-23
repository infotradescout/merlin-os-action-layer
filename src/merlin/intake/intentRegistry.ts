import type { MerlinActorScope, MerlinBrand, MerlinEntityType, ProductAdapter } from './intakeTypes.js';

const adapters = new Map<MerlinBrand, ProductAdapter>();

export function registerProductAdapter(adapter: ProductAdapter): void {
  adapters.set(adapter.brand, adapter);
}

export function getProductAdapter(brand: MerlinBrand): ProductAdapter | undefined {
  return adapters.get(brand);
}

export function getRegisteredActions(): Array<{ brand: MerlinBrand; actionId: string; actorScope: MerlinActorScope }> {
  const rows: Array<{ brand: MerlinBrand; actionId: string; actorScope: MerlinActorScope }> = [];
  for (const adapter of adapters.values()) {
    for (const action of adapter.actions) {
      rows.push({ brand: action.brand, actionId: action.actionId, actorScope: action.actorScope });
    }
  }
  return rows;
}

export function validateIntentAgainstRegistry(input: {
  brand: MerlinBrand;
  actionId: string;
  actorScope: MerlinActorScope;
  entityType: MerlinEntityType;
  entityId?: string;
  userHint?: string;
}): { ok: true; action: ReturnType<ProductAdapter['getActionDefinition']> extends infer T ? Exclude<T, undefined> : never } | { ok: false; code: string; message: string } {
  const adapter = adapters.get(input.brand);
  if (!adapter) return { ok: false, code: 'INVALID_BRAND', message: 'brand is not registered' };
  return adapter.validateIntent(input) as
    | { ok: true; action: ReturnType<ProductAdapter['getActionDefinition']> extends infer T ? Exclude<T, undefined> : never }
    | { ok: false; code: string; message: string };
}

export function resetIntentRegistryForTest(): void {
  adapters.clear();
}
