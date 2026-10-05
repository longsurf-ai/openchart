// Purpose: Adapt an owned standard WebSocket to Hose without application event wiring.
import type { Link } from "./client";

/** Open a standard WebSocket; Hose owns its callbacks and disposal.
 * @example const client = new HoseClient(() => webSocketLink('wss://example.com/hose'));
 */
export function webSocketLink(url: string): Link {
  const socket = new WebSocket(url);
  return {
    get state() {
      return socket.readyState === 0
        ? "connecting"
        : socket.readyState === 1
          ? "open"
          : "closed";
    },
    send: (message) => socket.send(message),
    close: () => socket.close(),
    listen: (events) => {
      socket.onopen = events.open;
      socket.onmessage = (event) => events.message(event.data);
      socket.onerror = () => events.error();
      socket.onclose = events.close;
      return () => {
        socket.onopen =
          socket.onmessage =
          socket.onerror =
          socket.onclose =
            null;
      };
    },
  };
}
