/* evelyn_robotics.js - Offline Robotics Simulator, Kinematics (Diff-Drive & 2-Link IK),
   PID Controller, 1D Kalman Filter, 8-Byte Checksummed Hardware Protocol, Safety Governor,
   Grammar-Locked AI Robot Commands & Web Serial Bridge.
   Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    if (!root.EvelynBackend) require("./evelyn_backend.js");
    if (!root.EvelynFrontier) require("./evelyn_frontier.js");
  }

  var F = root.EvelynFrontier;

  /* =========================================================================
     1. 1D KALMAN FILTER (SMOOTHS NOISY $1.50 ULTRASONIC / IR SENSORS)
     ========================================================================= */
  function Kalman1D(qProcess, rMeasure, initEst) {
    this.q = qProcess !== undefined ? qProcess : 0.08;
    this.r = rMeasure !== undefined ? rMeasure : 2.5;
    this.x = initEst !== undefined ? initEst : 0.0;
    this.p = 1.0;
  }
  Kalman1D.prototype.update = function (measurement) {
    this.p += this.q;
    var k = this.p / (this.p + this.r);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1.0 - k) * this.p;
    return this.x;
  };

  /* =========================================================================
     2. PID CONTROLLER WITH ANTI-WINDUP CLAMP (WALL / LINE / JOINT CONTROL)
     ========================================================================= */
  function PIDController(kp, ki, kd, opts) {
    opts = opts || {};
    this.kp = kp || 0; this.ki = ki || 0; this.kd = kd || 0;
    this.minOut = opts.minOut !== undefined ? opts.minOut : -100;
    this.maxOut = opts.maxOut !== undefined ? opts.maxOut : 100;
    this.maxIntegral = opts.maxIntegral !== undefined ? opts.maxIntegral : 50;
    this.integral = 0.0;
    this.prevErr = 0.0;
    this.hasPrev = false;
  }
  PIDController.prototype.reset = function () {
    this.integral = 0.0; this.prevErr = 0.0; this.hasPrev = false;
  };
  PIDController.prototype.step = function (setpoint, measured, dt) {
    var d = dt > 1e-4 ? dt : 0.05;
    var err = setpoint - measured;
    this.integral += err * d;
    if (this.integral > this.maxIntegral) this.integral = this.maxIntegral;
    if (this.integral < -this.maxIntegral) this.integral = -this.maxIntegral;
    var deriv = this.hasPrev ? (err - this.prevErr) / d : 0.0;
    this.prevErr = err; this.hasPrev = true;
    var out = this.kp * err + this.ki * this.integral + this.kd * deriv;
    /* Conditional-integration anti-windup: while the output is pinned at a limit and the error still pushes the
       same way, this step's integral gain is undone, otherwise the stored integral overshoots the target. */
    if ((out > this.maxOut && err > 0) || (out < this.minOut && err < 0)) this.integral -= err * d;
    if (out > this.maxOut) out = this.maxOut;
    if (out < this.minOut) out = this.minOut;
    return out;
  };

  /* =========================================================================
     3. 2-LINK ROBOTIC ARM FORWARD & ANALYTICAL INVERSE KINEMATICS
        Drives two micro-servos (shoulder + elbow) with safe reach clamping.
     ========================================================================= */
  var Arm2Link = {
    fk: function (theta1Rad, theta2Rad, L1, L2) {
      var x1 = L1 * Math.cos(theta1Rad);
      var y1 = L1 * Math.sin(theta1Rad);
      var x2 = x1 + L2 * Math.cos(theta1Rad + theta2Rad);
      var y2 = y1 + L2 * Math.sin(theta1Rad + theta2Rad);
      return { elbowX: x1, elbowY: y1, tipX: x2, tipY: y2 };
    },
    ik: function (targetX, targetY, L1, L2, elbowUp) {
      var rRaw = Math.sqrt(targetX * targetX + targetY * targetY);
      var minR = Math.abs(L1 - L2) + 0.001;
      var maxR = (L1 + L2) - 0.001;
      var clamped = false, tx = targetX, ty = targetY, r = rRaw;

      if (rRaw > maxR || rRaw < minR) {
        clamped = true;
        r = rRaw > maxR ? maxR : minR;
        var ang = Math.atan2(targetY, targetX);
        tx = r * Math.cos(ang);
        ty = r * Math.sin(ang);
      }
      var cosT2 = (r * r - L1 * L1 - L2 * L2) / (2.0 * L1 * L2);
      if (cosT2 > 1.0) cosT2 = 1.0;
      if (cosT2 < -1.0) cosT2 = -1.0;
      var t2 = Math.acos(cosT2);
      if (elbowUp) t2 = -t2;
      var t1 = Math.atan2(ty, tx) - Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2));
      return {
        theta1Rad: t1,
        theta2Rad: t2,
        servo1Deg: Math.max(0, Math.min(180, Math.round(t1 * 180 / Math.PI + 90))),
        servo2Deg: Math.max(0, Math.min(180, Math.round(t2 * 180 / Math.PI + 90))),
        clamped: clamped
      };
    }
  };

  /* =========================================================================
     4. DIFFERENTIAL-DRIVE ROVER SIMULATOR (WITH WHEEL SLIP & 3-RAY ULTRASONIC)
     ========================================================================= */
  function DiffDriveSim(opts) {
    opts = opts || {};
    this.x = opts.x || 50;
    this.y = opts.y || 120;
    this.heading = opts.heading || 0;      // radians (0 = +X east)
    this.wheelBase = opts.wheelBase || 18; // cm between wheels
    this.maxSpeed = opts.maxSpeed || 40;   // cm/s at PWM 100
    this.leftSlip = opts.leftSlip || 1.0;  // 0.85 simulates carpet/motor drag!
    this.rightSlip = opts.rightSlip || 1.0;
    this.walls = opts.walls || [
      { x1: 0, y1: 0, x2: 300, y2: 0 }, { x1: 300, y1: 0, x2: 300, y2: 240 },
      { x1: 300, y1: 240, x2: 0, y2: 240 }, { x1: 0, y1: 240, x2: 0, y2: 0 }
    ];
  }

  DiffDriveSim.prototype.step = function (leftPwm, rightPwm, dt) {
    var d = dt || 0.05;
    var vL = (Math.max(-100, Math.min(100, leftPwm)) / 100.0) * this.maxSpeed * this.leftSlip;
    var vR = (Math.max(-100, Math.min(100, rightPwm)) / 100.0) * this.maxSpeed * this.rightSlip;
    var v = 0.5 * (vL + vR);
    var omega = (vR - vL) / this.wheelBase;
    this.heading += omega * d;
    this.x += v * Math.cos(this.heading) * d;
    this.y += v * Math.sin(this.heading) * d;
    return { x: this.x, y: this.y, heading: this.heading, v: v, omega: omega };
  };

  /* 2D ray-segment intersection for simulated ultrasonic / LIDAR distance */
  DiffDriveSim.prototype.castRay = function (angleOffsetRad, maxRange) {
    var ang = this.heading + (angleOffsetRad || 0);
    var rdx = Math.cos(ang), rdy = Math.sin(ang);
    var best = maxRange || 200;
    for (var i = 0; i < this.walls.length; i++) {
      var w = this.walls[i];
      var sdx = w.x2 - w.x1, sdy = w.y2 - w.y1;
      var denom = rdx * sdy - rdy * sdx;
      if (Math.abs(denom) < 1e-8) continue;
      var qpx = w.x1 - this.x, qpy = w.y1 - this.y;
      var t = (qpx * sdy - qpy * sdx) / denom;
      var u = (qpx * rdy - qpy * rdx) / denom;
      if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best;
  };

  DiffDriveSim.prototype.readUltrasonic3 = function (noiseRng) {
    var noise = function () { return noiseRng ? ((noiseRng() * 2 - 1) * 2.5) : 0; };
    return {
      left:   Math.max(1, this.castRay(-0.55, 200) + noise()),
      front:  Math.max(1, this.castRay(0, 200) + noise()),
      right:  Math.max(1, this.castRay(0.55, 200) + noise())
    };
  };

  /* =========================================================================
     5. 8-BYTE CHECKSUMMED HARDWARE PROTOCOL + HARD SAFETY GOVERNOR
        Packet: [0xAA, cmd, int8(leftPWM), int8(rightPWM), u8(s1), u8(s2), seq, xor]
     ========================================================================= */
  var CMD = { STOP: 0, DRIVE: 1, SERVO: 2, PING: 3 };

  var RobotProtocol = {
    CMD: CMD,
    pack: function (cmd, leftPwm, rightPwm, servo1, servo2, seq) {
      var pkt = new Uint8Array(8);
      pkt[0] = 0xAA;
      pkt[1] = cmd & 255;
      pkt[2] = Math.max(-100, Math.min(100, Math.round(leftPwm || 0))) & 255;
      pkt[3] = Math.max(-100, Math.min(100, Math.round(rightPwm || 0))) & 255;
      pkt[4] = Math.max(0, Math.min(180, Math.round(servo1 !== undefined ? servo1 : 90)));
      pkt[5] = Math.max(0, Math.min(180, Math.round(servo2 !== undefined ? servo2 : 90)));
      pkt[6] = (seq || 0) & 255;
      var xor = 0;
      for (var i = 0; i < 7; i++) xor ^= pkt[i];
      pkt[7] = xor;
      return pkt;
    },
    unpack: function (pkt) {
      if (!pkt || pkt.length !== 8 || pkt[0] !== 0xAA) return { ok: false, error: "Invalid header" };
      var xor = 0;
      for (var i = 0; i < 7; i++) xor ^= pkt[i];
      if (xor !== pkt[7]) return { ok: false, error: "Checksum mismatch" };
      var l = pkt[2] > 127 ? pkt[2] - 256 : pkt[2];
      var r = pkt[3] > 127 ? pkt[3] - 256 : pkt[3];
      return { ok: true, cmd: pkt[1], leftPwm: l, rightPwm: r, servo1: pkt[4], servo2: pkt[5], seq: pkt[6] };
    }
  };

  /* Hard Safety Governor: clamps motor speed, enforces e-stop & dead-man watchdog */
  function SafetyGovernor(opts) {
    opts = opts || {};
    this.maxPwm = opts.maxPwm !== undefined ? opts.maxPwm : 70; // Kid-safe default ceiling
    this.watchdogMs = opts.watchdogMs !== undefined ? opts.watchdogMs : 500;
    this.estop = false;
    this.lastCommandAt = 0;
    this.seq = 0;
  }

  SafetyGovernor.prototype.heartbeat = function (nowMs) {
    this.lastCommandAt = nowMs !== undefined ? nowMs : Date.now();
  };

  SafetyGovernor.prototype.triggerEStop = function () { this.estop = true; };
  SafetyGovernor.prototype.clearEStop = function () { this.estop = false; };

  SafetyGovernor.prototype.guardCommand = function (cmd, leftPwm, rightPwm, servo1, servo2, nowMs) {
    var now = nowMs !== undefined ? nowMs : Date.now();
    var timedOut = (this.lastCommandAt > 0 && (now - this.lastCommandAt) > this.watchdogMs);
    var safeCmd = cmd, l = leftPwm || 0, r = rightPwm || 0;
    var reason = "ok";

    if (this.estop) {
      safeCmd = CMD.STOP; l = 0; r = 0; reason = "estop_active";
    } else if (timedOut) {
      safeCmd = CMD.STOP; l = 0; r = 0; reason = "watchdog_timeout";
    } else {
      if (l > this.maxPwm) { l = this.maxPwm; reason = "clamped"; }
      if (l < -this.maxPwm) { l = -this.maxPwm; reason = "clamped"; }
      if (r > this.maxPwm) { r = this.maxPwm; reason = "clamped"; }
      if (r < -this.maxPwm) { r = -this.maxPwm; reason = "clamped"; }
    }
    var pkt = RobotProtocol.pack(safeCmd, l, r, servo1, servo2, ++this.seq);
    return { packet: pkt, leftPwm: l, rightPwm: r, cmd: safeCmd, reason: reason };
  };

  /* Grammar-Locked AI Motor Command DFA (plugs directly into EvelynFrontier.GrammarDecoder)
     Guarantees an AI model can ONLY output: STOP, FWD 00..99, REV 00..99, LFT 00..99, RGT 00..99 */
  function robotCommandGrammar(prefix) {
    var heads = ["STOP\n", "FWD ", "REV ", "LFT ", "RGT "];
    var allowed = "", i;
    for (i = 0; i < heads.length; i++) {
      if (heads[i].indexOf(prefix) === 0) {
        var ch = heads[i].charAt(prefix.length);
        if (ch && allowed.indexOf(ch) < 0) allowed += ch;
      }
    }
    if (allowed) return allowed;
    if (prefix.length === 4 || prefix.length === 5) return "0123456789";
    return "\n";
  }

  function parseSafeRobotCommand(cmdStr, gov, nowMs) {
    var s = String(cmdStr || "").trim().toUpperCase();
    if (s === "STOP") return gov.guardCommand(CMD.STOP, 0, 0, 90, 90, nowMs);
    var m = s.match(/^(FWD|REV|LFT|RGT)\s+(\d{1,2})$/);
    if (!m) return gov.guardCommand(CMD.STOP, 0, 0, 90, 90, nowMs);
    var sp = parseInt(m[2], 10);
    if (m[1] === "FWD") return gov.guardCommand(CMD.DRIVE, sp, sp, 90, 90, nowMs);
    if (m[1] === "REV") return gov.guardCommand(CMD.DRIVE, -sp, -sp, 90, 90, nowMs);
    if (m[1] === "LFT") return gov.guardCommand(CMD.DRIVE, -sp, sp, 90, 90, nowMs);
    return gov.guardCommand(CMD.DRIVE, sp, -sp, 90, 90, nowMs);
  }

  /* =========================================================================
     6. SIM-TO-REAL BRIDGE (WEB SERIAL API + BITNET TERNARY POLICY + LOOPBACK)
     ========================================================================= */
  function SimToRealBridge(transport) {
    this.transport = transport || null; // optional custom or mock writer { write(u8) }
    this.port = null;
    this.writer = null;
    this.sentCount = 0;
  }

  SimToRealBridge.prototype.connectWebSerial = function (baudRate, cb) {
    var self = this;
    if (typeof navigator === "undefined" || !navigator.serial) {
      if (cb) cb(new Error("Web Serial unavailable in this browser; using Simulator/Loopback mode."));
      return;
    }
    navigator.serial.requestPort().then(function (port) {
      self.port = port;
      return port.open({ baudRate: baudRate || 115200 });
    }).then(function () {
      self.writer = self.port.writable.getWriter();
      if (cb) cb(null, true);
    })["catch"](function (err) {
      if (cb) cb(err);
    });
  };

  SimToRealBridge.prototype.sendPacket = function (pkt) {
    this.sentCount++;
    if (this.writer) return this.writer.write(pkt);
    if (this.transport && this.transport.write) return this.transport.write(pkt);
    return false;
  };

  /* Run a BitNet I2_S ternary policy (zero multiplications!) from 3 ultrasonic rays -> wheel PWM */
  function evalTernaryBotPolicy(packedTernaryPolicy, sensors, gov, nowMs) {
    var x = new Float32Array([sensors.left / 100.0, sensors.front / 100.0, sensors.right / 100.0, 1.0]);
    var y = new Float32Array(2);
    F.TernaryPacked.matvecTernary(packedTernaryPolicy, x, y);
    var lPwm = Math.tanh(y[0]) * 80;
    var rPwm = Math.tanh(y[1]) * 80;
    return gov.guardCommand(CMD.DRIVE, lPwm, rPwm, 90, 90, nowMs);
  }

  root.EvelynRobotics = {
    Kalman1D: Kalman1D,
    PIDController: PIDController,
    Arm2Link: Arm2Link,
    DiffDriveSim: DiffDriveSim,
    RobotProtocol: RobotProtocol,
    SafetyGovernor: SafetyGovernor,
    robotCommandGrammar: robotCommandGrammar,
    parseSafeRobotCommand: parseSafeRobotCommand,
    SimToRealBridge: SimToRealBridge,
    evalTernaryBotPolicy: evalTernaryBotPolicy
  };
})(typeof window !== "undefined" ? window : global);
