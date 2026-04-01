import net from "node:net";

/** TCP connect test (как asyncio.open_connection в telegram-bridge). */
export function tcpPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port }, () => {
      sock.end();
      resolve(true);
    });
    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => {
      resolve(false);
    });
  });
}
