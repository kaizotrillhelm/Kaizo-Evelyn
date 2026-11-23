/* evelyn_net.js - Ultra-low-bandwidth binary codecs for 56k / 2G multiplayer */
var EvelynNet = {
  /* 12-byte real-time player/physics frame (quantized to 16-bit ints) */
  packFrame: function (playerId, x, y, vx, vy, buttons, seq) {
    var buf = new ArrayBuffer(12);
    var v = new DataView(buf);
    v.setUint8(0, playerId & 255);
    v.setUint8(1, buttons & 255);
    v.setUint16(2, seq & 65535, true);
    v.setInt16(4, Math.round(x * 16), true);   // 1/16th pixel precision
    v.setInt16(6, Math.round(y * 16), true);
    v.setInt16(8, Math.round(vx * 256), true);
    v.setInt16(10, Math.round(vy * 256), true);
    return new Uint8Array(buf);
  },

  unpackFrame: function (u8) {
    var v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    return {
      playerId: v.getUint8(0),
      buttons: v.getUint8(1),
      seq: v.getUint16(2, true),
      x: v.getInt16(4, true) / 16,
      y: v.getInt16(6, true) / 16,
      vx: v.getInt16(8, true) / 256,
      vy: v.getInt16(10, true) / 256
    };
  },

  /* Pack a 30-float evolving Echo bot brain into just 36 bytes (8-bit quantized!) */
  packBotBrain: function (weightsFloat32) {
    var n = weightsFloat32.length;
    var big = 0, i;
    for (i = 0; i < n; i++) {
      var a = Math.abs(weightsFloat32[i]);
      if (a > big) big = a;
    }
    var scale = big > 1e-8 ? big / 127.0 : 1.0;
    var buf = new ArrayBuffer(6 + n);
    var v = new DataView(buf);
    v.setUint16(0, n, true);
    v.setFloat32(2, scale, true);
    for (i = 0; i < n; i++) {
      v.setInt8(6 + i, Math.max(-127, Math.min(127, Math.round(weightsFloat32[i] / scale))));
    }
    return new Uint8Array(buf); // 36 bytes total for a 30-weight AI creature!
  },

  unpackBotBrain: function (u8) {
    var v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var n = v.getUint16(0, true);
    var scale = v.getFloat32(2, true);
    var w = new Float32Array(n);
    for (var i = 0; i < n; i++) w[i] = v.getInt8(6 + i) * scale;
    return w;
  }
};

if (typeof window !== "undefined") window.EvelynNet = EvelynNet;
if (typeof module !== "undefined" && module.exports) module.exports = EvelynNet;
