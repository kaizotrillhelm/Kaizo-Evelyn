/* evelyn_robotics_tests.js - Automated ES5 Tests for EvelynRobotics
   Run in Node.js: node evelyn_robotics_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_frontier.js");
    require("./evelyn_robotics.js");
  }

  var B = root.EvelynBackend;
  var F = root.EvelynFrontier;
  var R = root.EvelynRobotics;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Differential-drive motion, spin, and ultrasonic raycasting */
  test("DiffDriveSim: Straight travel, spin-in-place, and ultrasonic wall distance", function (done) {
    var sim = new R.DiffDriveSim({ x: 50, y: 120, heading: 0 });
    var d0 = sim.castRay(0, 300);
    assert(Math.abs(d0 - 250) < 0.01, "Expected 250 cm to east wall, got " + d0);

    /* Drive straight east at 50% speed (20 cm/s) for 1.0 s -> x should reach 70 */
    for (var i = 0; i < 20; i++) sim.step(50, 50, 0.05);
    assert(Math.abs(sim.x - 70) < 0.1 && Math.abs(sim.y - 120) < 0.1, "Straight kinematics drift: " + sim.x + "," + sim.y);

    /* Spin in place: equal opposite PWM keeps (x,y) fixed and changes heading */
    var oldH = sim.heading;
    sim.step(-40, 40, 0.2);
    assert(Math.abs(sim.x - 70) < 0.1 && sim.heading > oldH, "Spin-in-place failed");
    done();
  });

  /* 2. 2-Link Robotic Arm Forward & Analytical Inverse Kinematics */
  test("Arm2Link: FK(IK(x,y)) hits target within 0.01 cm and safely clamps out-of-reach points", function (done) {
    var L1 = 10, L2 = 8;
    var ik = R.Arm2Link.ik(11, 7, L1, L2, false);
    assert(!ik.clamped, "Point (11,7) is reachable and should not clamp");
    var fk = R.Arm2Link.fk(ik.theta1Rad, ik.theta2Rad, L1, L2);
    assert(Math.abs(fk.tipX - 11) < 0.01 && Math.abs(fk.tipY - 7) < 0.01, "IK/FK mismatch: " + fk.tipX + "," + fk.tipY);
    assert(ik.servo1Deg >= 0 && ik.servo1Deg <= 180 && ik.servo2Deg >= 0 && ik.servo2Deg <= 180, "Servo angles out of [0,180]");

    /* Unreachable point (50, 50) must clamp cleanly without NaN */
    var farIk = R.Arm2Link.ik(50, 50, L1, L2, false);
    assert(farIk.clamped && isFinite(farIk.theta1Rad) && isFinite(farIk.theta2Rad), "Out-of-reach IK produced NaN");
    done();
  });

  /* 3. PID Controller convergence & 1D Kalman Filter noise reduction */
  test("PID & Kalman1D: PID converges to target wall distance and Kalman reduces sensor noise variance", function (done) {
    var pid = new R.PIDController(1.4, 0.05, 0.25, { minOut: -30, maxOut: 30, maxIntegral: 20 });
    var pos = 5.0, target = 25.0;
    for (var t = 0; t < 80; t++) {
      var u = pid.step(target, pos, 0.05);
      pos += u * 0.05;
    }
    assert(Math.abs(pos - target) < 0.5, "PID failed to converge to 25.0, ended at " + pos.toFixed(2));

    var rng = B.createRng(77);
    var kf = new R.Kalman1D(0.05, 4.0, 50.0);
    var rawErr = 0, filtErr = 0;
    for (var i = 0; i < 60; i++) {
      var meas = 50.0 + (rng() * 2 - 1) * 6.0;
      var est = kf.update(meas);
      rawErr += Math.abs(meas - 50.0);
      filtErr += Math.abs(est - 50.0);
    }
    assert(filtErr < rawErr * 0.45, "Kalman filter did not reduce noise enough (" + filtErr.toFixed(1) + " vs " + rawErr.toFixed(1) + ")");
    done();
  });

  /* 4. 8-Byte Checksum Protocol, Safety Governor Watchdog, E-Stop & Grammar-Locked AI Control */
  test("SafetyGovernor & GrammarDecoder: Checksum validation, PWM clamp, watchdog stop, and legal AI commands", function (done) {
    var gov = new R.SafetyGovernor({ maxPwm: 60, watchdogMs: 500 });
    gov.heartbeat(1000);

    /* Excess speed (100) clamped to kid-safe 60 */
    var g1 = gov.guardCommand(R.RobotProtocol.CMD.DRIVE, 100, -95, 90, 90, 1100);
    assertEq(g1.leftPwm, 60, "Left PWM should clamp to 60");
    assertEq(g1.rightPwm, -60, "Right PWM should clamp to -60");
    assertEq(g1.reason, "clamped", "Should report clamped reason");

    /* Packet round-trip + corruption detection */
    var up = R.RobotProtocol.unpack(g1.packet);
    assert(up.ok && up.leftPwm === 60 && up.rightPwm === -60, "Packet unpack failed");
    var corrupt = new Uint8Array(g1.packet); corrupt[2] ^= 0x0F;
    assert(!R.RobotProtocol.unpack(corrupt).ok, "Corrupted checksum should be rejected");

    /* Dead-man watchdog forces STOP after > 500 ms with no heartbeat */
    var gTimeout = gov.guardCommand(R.RobotProtocol.CMD.DRIVE, 50, 50, 90, 90, 1650);
    assertEq(gTimeout.cmd, R.RobotProtocol.CMD.STOP, "Watchdog timeout must force STOP");
    assertEq(gTimeout.leftPwm, 0, "Watchdog must zero left PWM");

    /* E-Stop forces STOP even with fresh heartbeat */
    gov.heartbeat(2000);
    gov.triggerEStop();
    var gStop = gov.guardCommand(R.RobotProtocol.CMD.DRIVE, 40, 40, 90, 90, 2050);
    assertEq(gStop.reason, "estop_active", "E-stop must block movement");
    gov.clearEStop();

    /* GrammarDecoder + robotCommandGrammar forces noisy AI logits to legal commands only */
    var rng = B.createRng(314);
    function randLogits() {
      var arr = new Float32Array(97);
      for (var i = 0; i < 97; i++) arr[i] = rng() * 4 - 2;
      return arr;
    }
    for (var k = 0; k < 12; k++) {
      var dec = F.GrammarDecoder.decode(R.robotCommandGrammar, randLogits, { maxLen: 10 });
      assert(/^(?:STOP|(?:FWD|REV|LFT|RGT) \d{2})$/.test(dec.text), "Illegal AI robot command emitted: '" + dec.text + "'");
      var guarded = R.parseSafeRobotCommand(dec.text, gov, 2100);
      assert(R.RobotProtocol.unpack(guarded.packet).ok, "Guarded AI command produced invalid packet");
    }
    done();
  });

  /* 5. Sim-to-Real BitNet Ternary Policy + Loopback Bridge */
  test("SimToRealBridge: BitNet I2_S ternary policy drives rover through SafetyGovernor over transport", function (done) {
    var received = [];
    var bridge = new R.SimToRealBridge({ write: function (pkt) { received.push(pkt); return true; } });
    var sim = new R.DiffDriveSim({ x: 80, y: 120, heading: 0 });
    var gov = new R.SafetyGovernor({ maxPwm: 65, watchdogMs: 500 });

    /* Pack a 2x4 BitNet ternary obstacle-steering policy (zero inner-loop multiplies) */
    var policy = F.BitNetI2S.packTernary(new Float32Array([0.9, 0.8, -0.7, 0.2, -0.7, 0.8, 0.9, 0.2]), 2, 4);
    gov.heartbeat(100);
    var sensors = sim.readUltrasonic3();
    var res = R.evalTernaryBotPolicy(policy, sensors, gov, 150);
    bridge.sendPacket(res.packet);

    assertEq(received.length, 1, "Bridge should transmit 1 binary packet");
    var decoded = R.RobotProtocol.unpack(received[0]);
    assert(decoded.ok && Math.abs(decoded.leftPwm) <= 65 && Math.abs(decoded.rightPwm) <= 65, "Transmitted ternary policy command out of bounds");
    done();
  });

  /* 6. ES5 Compatibility Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax blockers in evelyn_robotics.js and evelyn_robotics_tests.js", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_robotics.js", "evelyn_robotics_tests.js"];
      var banned = [
        [/\bArray\.from\s*\(/, "Array.from"],
        [/\bnew\s+Map\s*\(/, "new Map"],
        [/\bnew\s+Set\s*\(/, "new Set"],
        [new RegExp("=" + ">"), "arrow function"],
        [/\(\?</, "ES2018 regex lookbehind"]
      ];
      for (var i = 0; i < files.length; i++) {
        var fp = path.join(__dirname, files[i]);
        if (!fs.existsSync(fp)) continue;
        var src = fs.readFileSync(fp, "utf8");
        for (var j = 0; j < banned.length; j++) {
          assert(!banned[j][0].test(src), files[i] + " failed ES5 guard: " + banned[j][1]);
        }
      }
      done();
    });
  }

  /* Runner */
  function runAll(logFn, onDone) {
    logFn = logFn || function (s) { console.log(s); };
    var pass = 0, fail = 0, idx = 0, t0 = Date.now();
    function next() {
      if (idx >= tests.length) {
        logFn("\n=== ROBOTICS SUITE RESULT: " + pass + " passed, " + fail + " failed (" + (Date.now() - t0) + " ms) ===");
        if (onDone) onDone(pass, fail);
        if (isNode) process.exit(fail > 0 ? 1 : 0);
        return;
      }
      var cur = tests[idx++], ended = false;
      function done(err) {
        if (ended) return; ended = true;
        if (err) { fail++; logFn("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
        else { pass++; logFn("[PASS] " + cur.name); }
        setTimeout(next, 0);
      }
      try { cur.fn(done); } catch (e) { done(e); }
    }
    logFn("=== EVELYN ROBOTICS, KINEMATICS & SIM-TO-REAL TESTS (" + tests.length + ") ===");
    next();
  }

  if (isNode) runAll();
  else root.EvelynRoboticsTests = { runAll: runAll };
})(typeof window !== "undefined" ? window : global);
