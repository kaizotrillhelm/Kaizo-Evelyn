/* evelyn_wasm_accel.js - Progressive Low-Level Accelerators for Evelyn:
   1. Self-contained WebAssembly 1.0 signed INT8 dot-product kernel (auto-fallback to ES5)
   2. WASM SIMD128 hardware feature detector
   3. 256-entry Float32 exp() Lookup Table over [-60, 0] for fast attention softmax
   4. 4-bit Q4_0 group-quantized (group=32) weight packer & matvec (~2x smaller than INT8)
   Pure ES5. Zero external .wasm files needed. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. COMPACT SELF-CONTAINED WEBASSEMBLY 1.0 BINARY EMITTER (i8_dot kernel)
     ========================================================================= */
  function lebU(n) {
    var out = [];
    do {
      var b = n & 0x7F;
      n >>>= 7;
      if (n !== 0) b |= 0x80;
      out.push(b);
    } while (n !== 0);
    return out;
  }

  function wasmSection(id, payload) {
    return [id].concat(lebU(payload.length), payload);
  }

  function buildDotWasmBytes() {
    var header = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
    /* Type 0: (i32, i32, i32) -> i32 */
    var secType = wasmSection(1, [0x01, 0x60, 0x03, 0x7F, 0x7F, 0x7F, 0x01, 0x7F]);
    /* Func 0 -> Type 0 */
    var secFunc = wasmSection(3, [0x01, 0x00]);
    /* Memory 0: 2 pages (128 KB) */
    var secMem  = wasmSection(5, [0x01, 0x00, 0x02]);
    /* Exports: "mem" (memory 0), "dot" (func 0) */
    var secExp  = wasmSection(7, [
      0x02,
      0x03, 0x6D, 0x65, 0x6D, 0x02, 0x00,
      0x03, 0x64, 0x6F, 0x74, 0x00, 0x00
    ]);
    /* Body for dot(wOff=0, xOff=1, len=2) -> acc=4 (i=3) */
    var funcBody = [
      0x01, 0x02, 0x7F,             // 2 local i32s: local 3 (i), local 4 (acc)
      0x02, 0x40,                   // block $exit
        0x03, 0x40,                 //   loop $L
          0x20, 0x03,               //     local.get i
          0x20, 0x02,               //     local.get len
          0x4E,                     //     i32.ge_s
          0x0D, 0x01,               //     br_if $exit
          0x20, 0x04,               //     local.get acc
          0x20, 0x00, 0x20, 0x03, 0x6A, 0x2C, 0x00, 0x00, // i32.load8_s(wOff + i)
          0x20, 0x01, 0x20, 0x03, 0x6A, 0x2C, 0x00, 0x00, // i32.load8_s(xOff + i)
          0x6C,                     //     i32.mul
          0x6A,                     //     i32.add
          0x21, 0x04,               //     local.set acc
          0x20, 0x03, 0x41, 0x01, 0x6A, 0x21, 0x03, // i = i + 1
          0x0C, 0x00,               //     br $L
        0x0B,                       //   end loop
      0x0B,                         // end block
      0x20, 0x04,                   // local.get acc
      0x0B                          // end func
    ];
    var secCode = wasmSection(10, [0x01].concat(lebU(funcBody.length), funcBody));
    return new Uint8Array(header.concat(secType, secFunc, secMem, secExp, secCode));
  }

  /* Probe whether this CPU/browser supports WebAssembly SIMD128 (v128 type 0x7B) */
  function detectSIMD128() {
    if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") return false;
    try {
      var probe = new Uint8Array([
        0x00,0x61,0x73,0x6D, 0x01,0x00,0x00,0x00,
        0x01,0x05,0x01,0x60,0x00,0x01,0x7B,
        0x03,0x02,0x01,0x00,
        0x0A,0x0A,0x01,0x08,0x00,0xFD,0x0C,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x0B
      ]);
      /* Simpler valid v128.const probe: body len 20 */
      var vProbe = new Uint8Array([
        0x00,0x61,0x73,0x6D,0x01,0x00,0x00,0x00,
        0x01,0x05,0x01,0x60,0x00,0x01,0x7B,
        0x03,0x02,0x01,0x00,
        0x0A,0x16,0x01,0x14,0x00,0xFD,0x0C, 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0x0B
      ]);
      void probe;
      return WebAssembly.validate(vProbe);
    } catch (e) { return false; }
  }

  var wasmInst = null, wasmMemI8 = null, wasmReady = false;
  (function initWasm() {
    if (typeof WebAssembly === "undefined") return;
    try {
      var mod = new WebAssembly.Module(buildDotWasmBytes());
      wasmInst = new WebAssembly.Instance(mod);
      wasmMemI8 = new Int8Array(wasmInst.exports.mem.buffer);
      wasmReady = true;
    } catch (e) { wasmReady = false; }
  })();

  /* Native WASM INT8 dot product with bit-exact ES5 scalar fallback */
  function dotInt8(wArr, wOff, xArr, len) {
    if (wasmReady && len <= 32768) {
      var xBase = (len + 15) & ~15;
      for (var i = 0; i < len; i++) {
        wasmMemI8[i] = wArr[wOff + i];
        wasmMemI8[xBase + i] = xArr[i];
      }
      return wasmInst.exports.dot(0, xBase, len);
    }
    var acc = 0;
    for (var j = 0; j < len; j++) acc = (acc + wArr[wOff + j] * xArr[j]) | 0;
    return acc;
  }

  /* =========================================================================
     2. 256-ENTRY EXP() LOOKUP TABLE OVER [-60, 0] (NO Math.exp IN SOFTMAX)
     ========================================================================= */
  var EXP_LUT_N = 256;
  var EXP_MIN = -60.0;
  var EXP_LUT = new Float32Array(EXP_LUT_N + 1);
  (function initExpLut() {
    for (var i = 0; i <= EXP_LUT_N; i++) {
      var x = EXP_MIN + (i / EXP_LUT_N) * (-EXP_MIN);
      EXP_LUT[i] = Math.exp(x);
    }
  })();

  function fastExp(x) {
    if (x >= 0.0) return 1.0;
    if (x <= EXP_MIN) return 0.0;
    var f = ((x - EXP_MIN) / (-EXP_MIN)) * EXP_LUT_N;
    var idx = f | 0;
    var frac = f - idx;
    return EXP_LUT[idx] + frac * (EXP_LUT[idx + 1] - EXP_LUT[idx]);
  }

  /* =========================================================================
     3. 4-BIT Q4_0 GROUP-QUANTIZED WEIGHTS (GROUP=32, ~2x SMALLER THAN INT8)
        Signed nibbles [-7..+7] stored as unsigned [0..14] (2 weights per byte).
     ========================================================================= */
  var Q4_GROUP = 32;
  var Q4Codec = {
    packQ4: function (floatW, rows, cols) {
      var n = rows * cols;
      var numGroups = Math.ceil(n / Q4_GROUP);
      var scales = new Float32Array(numGroups);
      var packed = new Uint8Array(Math.ceil(n / 2));

      for (var g = 0; g < numGroups; g++) {
        var start = g * Q4_GROUP;
        var end = Math.min(n, start + Q4_GROUP);
        var maxAbs = 0.0, i;
        for (i = start; i < end; i++) {
          var a = Math.abs(floatW[i]);
          if (a > maxAbs) maxAbs = a;
        }
        var sc = maxAbs > 1e-8 ? (maxAbs / 7.0) : 1.0;
        scales[g] = sc;
        for (i = start; i < end; i++) {
          var q = Math.max(-7, Math.min(7, Math.round(floatW[i] / sc))) + 7; // 0..14
          if ((i & 1) === 0) packed[i >> 1] |= (q & 0x0F);
          else packed[i >> 1] |= ((q & 0x0F) << 4);
        }
      }
      return {
        rows: rows, cols: cols, scales: scales, packed: packed,
        stats: {
          int8Bytes: n,
          q4Bytes: packed.length + scales.byteLength,
          compressionVsInt8: n / (packed.length + scales.byteLength)
        }
      };
    },

    matvecQ4: function (q4Obj, x, y) {
      var rows = q4Obj.rows, cols = q4Obj.cols, p = q4Obj.packed, sc = q4Obj.scales;
      for (var r = 0; r < rows; r++) {
        var acc = 0.0, base = r * cols;
        for (var c = 0; c < cols; c++) {
          var idx = base + c;
          var byteVal = p[idx >> 1];
          var nib = ((idx & 1) === 0) ? (byteVal & 0x0F) : ((byteVal >>> 4) & 0x0F);
          var w = (nib - 7) * sc[(idx / Q4_GROUP) | 0];
          acc += w * x[c];
        }
        y[r] = acc;
      }
    }
  };

  root.EvelynWasmAccel = {
    wasmReady: wasmReady,
    hasSIMD128: detectSIMD128(),
    dotInt8: dotInt8,
    fastExp: fastExp,
    Q4Codec: Q4Codec
  };
})(typeof window !== "undefined" ? window : global);
