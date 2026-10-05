// Purpose: Borrow the connection-owned Tea client from the application composition.
import { useContext } from "react";
import { TeaClientContext } from "@openchart/app/lib/tea/context";

/** Read the shared client without owning its shutdown. Requires app composition above it.
 * @example const tea = useTeaClient(); const node = await tea.compile(source);
 */
export function useTeaClient() {
  const client = useContext(TeaClientContext);
  if (!client) throw new Error("Tea access requires TeaClientContext.Provider");
  return client;
}
