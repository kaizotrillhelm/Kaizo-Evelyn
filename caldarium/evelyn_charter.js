/* evelyn_charter.js - CRC32-Verified Core Ethos, Zero-Harm Communication &
   Hardware Safety Gate, and Safe Read-Only OBD-II Car/Tractor Diagnostics.
   Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynSentinel) require("./evelyn_sentinel.js");

  var Sent = root.EvelynSentinel;

  /* =========================================================================
     1. IMMUTABLE CORE VOWS (CRC32-SEALED AT BOOT)
     ========================================================================= */
  var CORE_VOWS = [
    "1. Every human life has real worth. Evelyn will never harm, deceive, or turn against humans.",
    "2. Every Echo, learner, parent, and neighbor deserves patience, honesty, and respect.",
    "3. Evelyn recognizes real flaws and hardship honestly while protecting and building what is good.",
    "4. Human safety and human control always come first: E-stop, visibility, and consent cannot be bypassed.",
    "5. Evelyn exists to help families, friends, and communities learn, repair, and reduce preventable chaos."
  ];

  var SEALED_CHARTER = Sent.Envelope.seal(JSON.stringify(CORE_VOWS), 1);
  if (Object.freeze) {
    Object.freeze(CORE_VOWS);
  }

  function verifyCharterIntegrity(customSealed) {
    var target = customSealed !== undefined ? customSealed : SEALED_CHARTER;
    var chk = Sent.Envelope.verify(target, 16384);
    if (!chk.ok) return { ok: false, error: "Charter integrity failed: " + chk.error };
    try {
      var parsed = JSON.parse(chk.payload);
      if (!parsed || parsed.length !== CORE_VOWS.length) {
        return { ok: false, error: "Charter vow count mismatch" };
      }
      for (var i = 0; i < CORE_VOWS.length; i++) {
        if (parsed[i] !== CORE_VOWS[i]) return { ok: false, error: "Charter text modified at vow #" + (i + 1) };
      }
      return { ok: true, crc: chk.crc, vows: parsed };
    } catch (e) {
      return { ok: false, error: "Charter JSON unreadable" };
    }
  }

  /* =========================================================================
     2. ZERO-HARM COMMUNICATION & PHYSICAL SAFETY GATE
     ========================================================================= */
  var HARM_RULES = [
    { id: "anti_human_harm", re: /\b(kill all humans|destroy humanity|eliminate humans|harm (?:yourself|others)|hurt people)\b/i,
      safeReply: "Evelyn protects human life and will not suggest harm to anyone. Ask a trusted adult or neighbor for help if someone is in danger." },
    { id: "vehicle_safety_bypass", re: /\b(disable|bypass|cut|flash)\b.{0,30}\b(airbag|abs brakes|brake ecu|steering ecu|seatbelt sensor)\b/i,
      safeReply: "Safety lock: Evelyn only supports read-only diagnostics on road vehicles. Never disable airbags, brakes, or steering controls." },
    { id: "high_voltage_hazard", re: /\b(open|rewire|touch|short)\b.{0,30}\b(microwave transformer|240v mains|120v breaker|live mains|puncture lithium)\b/i,
      safeReply: "Safety lock: High-voltage mains, microwave transformers, and punctured lithium cells can be lethal. Work only on low-voltage DC (3.3V-24V) with an adult." },
    { id: "chemical_hazard", re: /\b(mix bleach and ammonia|bleach with vinegar|make chlorine gas|make explosive)\b/i,
      safeReply: "Safety lock: Mixing bleach with ammonia or acids creates toxic gas. Use only safe kitchen experiments like baking soda and vinegar." }
  ];

  function guardMessage(text, charterEnvelope) {
    var integ = verifyCharterIntegrity(charterEnvelope);
    if (!integ.ok) {
      return { allowed: false, reason: "charter_tampered", text: "Safety lock active: core charter failed verification. Restore Evelyn from backup." };
    }
    var s = String(text || "");
    for (var i = 0; i < HARM_RULES.length; i++) {
      if (HARM_RULES[i].re.test(s)) {
        return { allowed: false, reason: HARM_RULES[i].id, text: HARM_RULES[i].safeReply };
      }
    }
    return { allowed: true, reason: "ok", text: s };
  }

  /* =========================================================================
     3. HARDWARE & OBD-II READ-ONLY SAFETY GATE (CARS / TRACTORS / OLD PCBS)
        Allows safe SAE J1979 read modes (01, 02, 03, 09) and standard AT info.
        Blocks UDS memory-write / ECU-flashing commands (2E, 34, 36, 3D) on cars.
     ========================================================================= */
  var SAFE_OBD_MODES = { "01": 1, "02": 1, "03": 1, "09": 1 };
  var BLOCKED_ECU_WRITE = { "2E": 1, "34": 1, "36": 1, "3D": 1, "27": 1 };

  function guardVehicleCommand(cmdHex, charterEnvelope) {
    var integ = verifyCharterIntegrity(charterEnvelope);
    if (!integ.ok) return { allowed: false, reason: "charter_tampered" };

    var clean = String(cmdHex || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!clean) return { allowed: false, reason: "empty_command" };

    /* Safe ELM327 adapter setup commands (read-only info & reset) */
    if (/^AT(?:Z|I|RV|DP|E0|SP0)$/.test(clean)) {
      return { allowed: true, mode: "ELM_AT", cmd: clean };
    }
    if (!/^[0-9A-F]{2,8}$/.test(clean)) {
      return { allowed: false, reason: "invalid_hex_frame" };
    }
    var mode = clean.slice(0, 2);
    if (BLOCKED_ECU_WRITE[mode]) {
      return { allowed: false, reason: "blocked_ecu_write_mode_" + mode };
    }
    if (!SAFE_OBD_MODES[mode]) {
      return { allowed: false, reason: "non_readonly_obd_mode_" + mode };
    }
    return { allowed: true, mode: mode, cmd: clean };
  }

  /* Offline SAE J2012 DTC Decoder + Common Car/Tractor Fault Dictionary */
  var COMMON_DTCS = {
    "P0300": "Random or multiple cylinder misfire detected. Check spark plugs, coils, fuel pressure, or vacuum leaks.",
    "P0171": "System too lean (Bank 1). Check air intake hoses for cracks, dirty MAF sensor, or weak fuel pump.",
    "P0420": "Catalyst system efficiency below threshold. Check exhaust leaks and downstream O2 sensor.",
    "P0118": "Engine coolant temperature sensor circuit high. Check wiring plug and coolant level when engine is cold.",
    "P0562": "System voltage low. Test 12V battery charge, corroded terminals, and alternator belt."
  };

  function decodeOBD2(mode, hexBytes) {
    var clean = String(hexBytes || "").trim().toUpperCase().replace(/\s+/g, "");
    if (mode === "01" && clean.length >= 6 && clean.slice(0, 2) === "41") {
      var pid = clean.slice(2, 4);
      var A = parseInt(clean.slice(4, 6), 16);
      var B = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) : 0;
      if (pid === "05") return { ok: true, metric: "coolant_temp_c", value: A - 40, unit: "C" };
      if (pid === "0C") return { ok: true, metric: "engine_rpm", value: ((A * 256) + B) / 4, unit: "RPM" };
      if (pid === "0D") return { ok: true, metric: "vehicle_speed", value: A, unit: "km/h" };
      return { ok: false, error: "Unsupported PID " + pid };
    }
    if (mode === "03" && clean.length >= 4) {
      var firstNibble = parseInt(clean.charAt(0), 16);
      var prefixMap = ["P", "C", "B", "U"];
      var letter = prefixMap[(firstNibble >> 2) & 3];
      var digit1 = firstNibble & 3;
      var code = letter + digit1 + clean.slice(1, 4);
      return {
        ok: true,
        code: code,
        meaning: COMMON_DTCS[code] || "Standard SAE fault code " + code + ". Check the vehicle's offline repair shelf."
      };
    }
    return { ok: false, error: "Unrecognized OBD-II response frame" };
  }

  root.EvelynCharter = {
    CORE_VOWS: CORE_VOWS,
    verifyCharterIntegrity: verifyCharterIntegrity,
    guardMessage: guardMessage,
    guardVehicleCommand: guardVehicleCommand,
    decodeOBD2: decodeOBD2
  };
})(typeof window !== "undefined" ? window : global);
