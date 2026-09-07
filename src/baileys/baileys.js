// Baileys v7 is ESM-only while this backend remains CommonJS. Keep the rest
// of the application architecture intact and load Baileys through one cached
// dynamic import boundary.
let baileysPromise;

function getBaileys() {
  if (!baileysPromise) {
    baileysPromise = import('@whiskeysockets/baileys');
  }
  return baileysPromise;
}

module.exports = { getBaileys };
