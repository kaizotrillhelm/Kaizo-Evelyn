/* evelyn_tny3.js - the TNY3 header: any vocabulary, any context length, optional assistant heads.

   TNY2 fixes VOCAB = 97 and CTX = 128 in the code. TNY3 writes both in the file, so one reader can serve a model whose
   tokens are letters, a 4,096-word subword table, or the token ids of another model (Inkling's), and whose context is
   1,024 or 2,048 with rotary positions instead of a fixed position table.

   Layout, 24 bytes, little endian:
     0..3   "TNY3"
     4..7   VOCAB   uint32
     8..11  CTX     uint32
     12..13 D       uint16   width of a token
     14..15 L       uint16   layers
     16..17 H       uint16   attention heads (D must divide by H)
     18..19 HID     uint16   feed-forward width
     20..21 FLAGS   uint16   bit 0 rotary positions, bit 1 assistant heads present
     22..23 NHEADS  uint16   number of scalar or class outputs of the assistant heads (effort, loop, one per shelf)

   What is here: the header reader, a header writer, and a parameter estimate. What is NOT here: the weight layout after the
   header, the rotary attention and the heads. This module reads and checks the header only; Evelyn's engine still runs
   TNY2 files (js/evelyn_core.js), and a TNY3 file is refused by it until a TNY3 engine is written.

   Written from a design in an AI Studio chat (see CREDITS.md). Changes: a header that asks for more than limits allow is
   refused (a damaged file must not ask for a 4-billion-entry table), the FLAGS bits that are not defined are refused, and
   NHEADS must be 0 unless the heads flag is set. Plain ES5. */
(function (root) {
  "use strict";

  var HEADER_BYTES = 24;
  var FLAG_ROPE = 1, FLAG_HEADS = 2;
  /* ceilings for a model that sits beside a large one: far above the sweet spot, far below a damaged field */
  var LIMITS = { vocab: 1048576, ctx: 1048576, d: 4096, l: 128, hid: 65535, nheads: 4096 };

  function parseTny3Header(buf, limits) {
    if (!buf || buf.byteLength < HEADER_BYTES) throw new Error("TNY3 buffer too short");
    var lim = limits || LIMITS;
    var v = new DataView(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength);
    var magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
    if (magic !== "TNY3") throw new Error("Not a TNY3 file");

    var VOCAB = v.getUint32(4, true), CTX = v.getUint32(8, true);
    var D = v.getUint16(12, true), L = v.getUint16(14, true), H = v.getUint16(16, true), HID = v.getUint16(18, true);
    var FLAGS = v.getUint16(20, true), NHEADS = v.getUint16(22, true);

    if (VOCAB < 2 || CTX < 16 || D < 8 || L < 1 || H < 1 || HID < 1 || D % H !== 0) throw new Error("Invalid TNY3 dimensions");
    if (VOCAB > lim.vocab || CTX > lim.ctx || D > lim.d || L > lim.l || HID > lim.hid || NHEADS > lim.nheads) {
      throw new Error("TNY3 header asks for more than the limits allow");
    }
    if (FLAGS & ~(FLAG_ROPE | FLAG_HEADS)) throw new Error("TNY3 header has flag bits that are not defined");
    if (!(FLAGS & FLAG_HEADS) && NHEADS !== 0) throw new Error("TNY3 header has assistant outputs but not the heads flag");
    if ((FLAGS & FLAG_HEADS) && NHEADS === 0) throw new Error("TNY3 header has the heads flag but no outputs");
    return {
      VOCAB: VOCAB, CTX: CTX, D: D, L: L, H: H, HD: (D / H) | 0, HID: HID,
      useRoPE: (FLAGS & FLAG_ROPE) !== 0,
      hasAssistantHeads: (FLAGS & FLAG_HEADS) !== 0,
      assistantOutputs: NHEADS
    };
  }

  function buildTny3Header(spec) {
    var buf = new ArrayBuffer(HEADER_BYTES), v = new DataView(buf);
    v.setUint8(0, 84); v.setUint8(1, 78); v.setUint8(2, 89); v.setUint8(3, 51);
    v.setUint32(4, spec.VOCAB, true); v.setUint32(8, spec.CTX, true);
    v.setUint16(12, spec.D, true); v.setUint16(14, spec.L, true); v.setUint16(16, spec.H, true); v.setUint16(18, spec.HID, true);
    var flags = (spec.useRoPE ? FLAG_ROPE : 0) | (spec.hasAssistantHeads ? FLAG_HEADS : 0);
    v.setUint16(20, flags, true); v.setUint16(22, spec.assistantOutputs || 0, true);
    return buf;
  }

  /* Weights of the layers and the token table, counted from the header (no biases; gains of 2 per layer plus one).
     The output layer shares the token table, as TNY2 does. A fixed position table (no rotary) adds CTX x D.
     This is an estimate for sizing a model, not the size of a file: the file layout is not defined yet. */
  function tny3ParamEstimate(h) {
    var perLayer = 4 * h.D * h.D + 2 * h.D * h.HID + 2 * h.D;
    var emb = h.VOCAB * h.D, pos = h.useRoPE ? 0 : h.CTX * h.D;
    var heads = h.hasAssistantHeads ? h.assistantOutputs * (h.D + 1) : 0;
    return { embedding: emb, positions: pos, layers: h.L * perLayer, heads: heads, total: emb + pos + h.L * perLayer + h.D + heads };
  }

  var API = { parseTny3Header: parseTny3Header, buildTny3Header: buildTny3Header, tny3ParamEstimate: tny3ParamEstimate, HEADER_BYTES: HEADER_BYTES, LIMITS: LIMITS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynTny3 = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
