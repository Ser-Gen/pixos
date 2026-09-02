# PeerJS 1.5.5, vendored

    https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js   (87 KB, unmodified)

Fetched for phase 16. Nothing was trimmed: it is one file and small enough that picking it
apart would cost more than it saved.

**Why it is here rather than on unpkg.** Explorer loaded it from a CDN, which meant the
whole of file sharing was dead on an offline boot with nothing on screen saying why — and
the same script tag was written into the page the guest was sent, so *their* browser had to
reach unpkg too. Vendoring it is also what makes a LAN broker worth offering: with the
library local and a `peerjs-server` on the same network, two PixOS machines in the same room
need no internet at all.

**What vendoring does not fix.** WebRTC still needs a broker to introduce two peers, and by
default that is the PeerJS cloud (`0.peerjs.com`) — an internet service. It also uses
Google's STUN server to discover addresses. `js/shell/peers.js` reads the broker from
`/settings/peers.json`, and the Peers panel says which one is in use, because "who
introduced us" is not something a system should keep to itself.

**The global.** The bundle is an IIFE that sets `window.Peer` and `window.peerjs`; it is
not a module and cannot be imported. It is loaded with a `<script>` tag from `index.html`,
and `peers.js` degrades — saying so — when the global is absent.

**Updating.** Replace the file, check `window.Peer` is still what the bundle sets, and run
`npm test`: `tests/peers.test.mjs` covers this project's own logic rather than the library,
so it will not catch an API change. The parts that touch the library are `connect`,
`accept` and `destroy` in `peers.js`.
