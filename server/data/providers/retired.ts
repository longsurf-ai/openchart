// Purpose: Keep permanently retired provider identities outside active registration.
import type { ProviderId } from "@openchart/market";

// Saved listings keep their original identity; retirement never remaps or deletes them.
const retiredProviders: ReadonlySet<string> = new Set(["openchart"]);

/** Whether this source has permanently stopped serving data, independently of configuration.
 * @example isRetiredProvider(ProviderId.make("openchart")); // true
 */
export function isRetiredProvider(provider: ProviderId): boolean {
  return retiredProviders.has(provider);
}
