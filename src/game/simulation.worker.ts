import { Authority, type AuthorityCommand } from "./authority";

const authority = new Authority((event) => postMessage(event));
onmessage = (event: MessageEvent<AuthorityCommand>) => authority.command(event.data);
let clock = performance.now();
setInterval(() => {
  const now = performance.now();
  authority.advance(now - clock);
  clock = now;
}, 16);
