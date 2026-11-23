/* evelyn_3d.js - Pure-ES5 Offline 3D Engine for Potato Hardware (Zero WebGL):
   1. Wavefront .OBJ Parser & Exporter (splits quads, handles negative indices, fuel-capped)
   2. Procedural Low-Poly Meshes (Cube, Pyramid, Spaceship)
   3. Focal-Length Camera3D (24mm/50mm/135mm matching CineCamera presets)
   4. SoftwareRenderer3D (Uint32Array ImageData + Float32Array Z-Buffer + Lambert shading)
   5. Raycaster25D (Fast DDA grid raycaster for 60 FPS first-person mazes)
   Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. WAVEFRONT .OBJ PARSER & EXPORTER (FUEL-CAPPED FOR WEAK CPUS)
     ========================================================================= */
  function parseOBJ(objText, opts) {
    opts = opts || {};
    var maxVerts = opts.maxVerts || 4096;
    var maxTris = opts.maxTris || 8192;
    if (typeof objText !== "string" || objText.trim() === "") {
      return { ok: false, error: "Empty .OBJ input." };
    }
    var lines = objText.split(/\r?\n/);
    var verts = [], tris = [];
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln || ln.charAt(0) === "#") continue;
      var parts = ln.split(/\s+/);
      if (parts[0] === "v" && parts.length >= 4) {
        if (verts.length >= maxVerts) return { ok: false, error: "OBJ exceeds vertex cap (" + maxVerts + ")." };
        var x = parseFloat(parts[1]), y = parseFloat(parts[2]), z = parseFloat(parts[3]);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return { ok: false, error: "Invalid vertex on line " + (i + 1) };
        verts.push(x, y, z);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      } else if (parts[0] === "f" && parts.length >= 4) {
        var vCount = verts.length / 3;
        var poly = [];
        for (var k = 1; k < parts.length; k++) {
          var rawIdx = parseInt(parts[k].split("/")[0], 10);
          if (!isFinite(rawIdx) || rawIdx === 0) return { ok: false, error: "Invalid face index on line " + (i + 1) };
          var idx = rawIdx < 0 ? (vCount + rawIdx) : (rawIdx - 1);
          if (idx < 0 || idx >= vCount) return { ok: false, error: "Face index out of bounds on line " + (i + 1) };
          poly.push(idx);
        }
        /* Fan-triangulate triangles, quads, and convex n-gons */
        for (var t = 1; t < poly.length - 1; t++) {
          if (tris.length / 3 >= maxTris) return { ok: false, error: "OBJ exceeds triangle cap (" + maxTris + ")." };
          tris.push(poly[0], poly[t], poly[t + 1]);
        }
      }
    }
    if (verts.length === 0 || tris.length === 0) return { ok: false, error: "OBJ has no geometry." };
    return {
      ok: true,
      mesh: {
        verts: new Float32Array(verts),
        tris: new Uint16Array(tris),
        vertexCount: verts.length / 3,
        triCount: tris.length / 3,
        bounds: { minX: minX, maxX: maxX, minY: minY, maxY: maxY, minZ: minZ, maxZ: maxZ }
      }
    };
  }

  function exportOBJ(mesh, name) {
    var out = ["# Exported by Evelyn 3D Studio", "o " + (name || "EvelynMesh")];
    var v = mesh.verts, t = mesh.tris, i;
    for (i = 0; i < v.length; i += 3) {
      out.push("v " + v[i].toFixed(4) + " " + v[i + 1].toFixed(4) + " " + v[i + 2].toFixed(4));
    }
    for (i = 0; i < t.length; i += 3) {
      out.push("f " + (t[i] + 1) + " " + (t[i + 1] + 1) + " " + (t[i + 2] + 1));
    }
    return out.join("\n");
  }

  /* =========================================================================
     2. BUILT-IN LOW-POLY PRIMITIVES (CUBE & RETRO SPACECRAFT)
     ========================================================================= */
  function makeCube(size) {
    var h = (size || 2) * 0.5;
    var verts = new Float32Array([
      -h,-h,-h,  h,-h,-h,  h, h,-h, -h, h,-h, // front (-Z)
      -h,-h, h,  h,-h, h,  h, h, h, -h, h, h  // back (+Z)
    ]);
    /* Outward CCW winding when viewed from outside */
    var tris = new Uint16Array([
      0,1,2, 0,2,3,  5,4,7, 5,7,6,
      4,0,3, 4,3,7,  1,5,6, 1,6,2,
      3,2,6, 3,6,7,  4,5,1, 4,1,0
    ]);
    return { verts: verts, tris: tris, vertexCount: 8, triCount: 12 };
  }

  function makeGlider() {
    var verts = new Float32Array([
      0, 0, 2.2,    -1.8, -0.2, -1.2,   1.8, -0.2, -1.2,   0, 0.7, -1.0
    ]);
    var tris = new Uint16Array([0,1,3, 0,3,2, 0,2,1, 1,2,3]);
    return { verts: verts, tris: tris, vertexCount: 4, triCount: 4 };
  }

  /* =========================================================================
     3. FOCAL-LENGTH CAMERA & CPU Z-BUFFER SOFTWARE RASTERIZER
     ========================================================================= */
  function Camera3D(opts) {
    opts = opts || {};
    this.x = opts.x || 0; this.y = opts.y || 0; this.z = opts.z !== undefined ? opts.z : -6;
    this.focalMm = opts.focalMm || 50; // 24mm wide, 50mm standard, 135mm telephoto
    this.nearZ = opts.nearZ || 0.25;
  }

  Camera3D.prototype.project = function (vx, vy, vz, width, height) {
    var z = vz - this.z;
    if (z <= this.nearZ) return null;
    var focalPx = (width * 0.5) * (this.focalMm / 18.0);
    return {
      sx: (width * 0.5) + ((vx - this.x) / z) * focalPx,
      sy: (height * 0.5) - ((vy - this.y) / z) * focalPx,
      z: z
    };
  };

  function SoftwareRenderer3D(width, height) {
    this.w = width || 160;
    this.h = height || 120;
    this.pixels = new Uint32Array(this.w * this.h); // Little-endian 0xAABBGGRR
    this.zBuf = new Float32Array(this.w * this.h);  // Stores 1/z (larger = closer)
    this.lightDir = [0.35, 0.65, -0.67];            // Normalized directional light
    this.lastStats = { drawnTris: 0, culledTris: 0, pixelsWritten: 0 };
  }

  SoftwareRenderer3D.prototype.clear = function (abgrColor) {
    var col = abgrColor !== undefined ? abgrColor : 0xFF1C0404; // Neon bg #04041c
    var n = this.w * this.h;
    for (var i = 0; i < n; i++) { this.pixels[i] = col; this.zBuf[i] = 0.0; }
    this.lastStats.drawnTris = 0; this.lastStats.culledTris = 0; this.lastStats.pixelsWritten = 0;
  };

  function packShadedRGBA(rgb, shade) {
    var r = Math.max(0, Math.min(255, Math.round(rgb[0] * shade)));
    var g = Math.max(0, Math.min(255, Math.round(rgb[1] * shade)));
    var b = Math.max(0, Math.min(255, Math.round(rgb[2] * shade)));
    return ((0xFF << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  SoftwareRenderer3D.prototype._rasterTri = function (p0, p1, p2, abgr) {
    var w = this.w, h = this.h;
    var minX = Math.max(0, Math.floor(Math.min(p0.sx, p1.sx, p2.sx)));
    var maxX = Math.min(w - 1, Math.ceil(Math.max(p0.sx, p1.sx, p2.sx)));
    var minY = Math.max(0, Math.floor(Math.min(p0.sy, p1.sy, p2.sy)));
    var maxY = Math.min(h - 1, Math.ceil(Math.max(p0.sy, p1.sy, p2.sy)));
    var area = (p2.sx - p0.sx) * (p1.sy - p0.sy) - (p2.sy - p0.sy) * (p1.sx - p0.sx);
    if (Math.abs(area) < 1e-4) return;
    var invArea = 1.0 / area;
    var iz0 = 1.0 / p0.z, iz1 = 1.0 / p1.z, iz2 = 1.0 / p2.z;
    var zBuf = this.zBuf, pix = this.pixels;

    for (var y = minY; y <= maxY; y++) {
      var py = y + 0.5;
      for (var x = minX; x <= maxX; x++) {
        var px = x + 0.5;
        var w0 = ((px - p1.sx) * (p2.sy - p1.sy) - (py - p1.sy) * (p2.sx - p1.sx)) * invArea;
        var w1 = ((px - p2.sx) * (p0.sy - p2.sy) - (py - p2.sy) * (p0.sx - p2.sx)) * invArea;
        var w2 = 1.0 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          var invZ = w0 * iz0 + w1 * iz1 + w2 * iz2;
          var idx = y * w + x;
          if (invZ > zBuf[idx]) {
            zBuf[idx] = invZ;
            pix[idx] = abgr;
            this.lastStats.pixelsWritten++;
          }
        }
      }
    }
  };

  SoftwareRenderer3D.prototype.drawMesh = function (mesh, transform, cam, baseRgb) {
    transform = transform || {};
    var tx = transform.x || 0, ty = transform.y || 0, tz = transform.z || 0;
    var rx = transform.rx || 0, ry = transform.ry || 0;
    var cosY = Math.cos(ry), sinY = Math.sin(ry), cosX = Math.cos(rx), sinX = Math.sin(rx);
    var rgb = baseRgb || [40, 228, 252]; // Neon cyan default

    var v = mesh.verts, nV = mesh.vertexCount;
    var worldV = new Float32Array(nV * 3);
    var proj = new Array(nV), i;

    for (i = 0; i < nV; i++) {
      var x0 = v[i * 3], y0 = v[i * 3 + 1], z0 = v[i * 3 + 2];
      var x1 = x0 * cosY + z0 * sinY;
      var z1 = -x0 * sinY + z0 * cosY;
      var y2 = y0 * cosX - z1 * sinX;
      var z2 = y0 * sinX + z1 * cosX;
      var wx = x1 + tx, wy = y2 + ty, wz = z2 + tz;
      worldV[i * 3] = wx; worldV[i * 3 + 1] = wy; worldV[i * 3 + 2] = wz;
      proj[i] = cam.project(wx, wy, wz, this.w, this.h);
    }

    var t = mesh.tris, ld = this.lightDir;
    for (i = 0; i < t.length; i += 3) {
      var i0 = t[i], i1 = t[i + 1], i2 = t[i + 2];
      var p0 = proj[i0], p1 = proj[i1], p2 = proj[i2];
      if (!p0 || !p1 || !p2) { this.lastStats.culledTris++; continue; }

      /* Compute world-space normal for backface culling & Lambert lighting */
      var ax = worldV[i0 * 3], ay = worldV[i0 * 3 + 1], az = worldV[i0 * 3 + 2];
      var e1x = worldV[i1 * 3] - ax, e1y = worldV[i1 * 3 + 1] - ay, e1z = worldV[i1 * 3 + 2] - az;
      var e2x = worldV[i2 * 3] - ax, e2y = worldV[i2 * 3 + 1] - ay, e2z = worldV[i2 * 3 + 2] - az;
      var nx = e1y * e2z - e1z * e2y;
      var ny = e1z * e2x - e1x * e2z;
      var nz = e1x * e2y - e1y * e2x;

      /* Cull triangles facing away from camera */
      var toCamDot = nx * (ax - cam.x) + ny * (ay - cam.y) + nz * (az - cam.z);
      if (toCamDot >= 0) { this.lastStats.culledTris++; continue; }

      var nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
      var diff = (nx * ld[0] + ny * ld[1] + nz * ld[2]) / nLen;
      var shade = 0.25 + 0.75 * Math.max(0.0, diff);
      this._rasterTri(p0, p1, p2, packShadedRGBA(rgb, shade));
      this.lastStats.drawnTris++;
    }
  };

  /* Blit software 3D buffer to any HTML Canvas in 1 draw call */
  SoftwareRenderer3D.prototype.blitToCanvas = function (canvas) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var img = ctx.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.pixels);
    ctx.putImageData(img, 0, 0);
  };

  /* =========================================================================
     4. 2.5D DDA RAYCASTER (TURNS ANY 2D MAZE INTO FIRST-PERSON 3D AT 60 FPS)
     ========================================================================= */
  var Raycaster25D = {
    castRay: function (gridRows, px, py, rayDirX, rayDirY, maxSteps) {
      var mapX = Math.floor(px), mapY = Math.floor(py);
      var deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1.0 / rayDirX);
      var deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1.0 / rayDirY);
      var stepX, stepY, sideDistX, sideDistY;

      if (rayDirX < 0) { stepX = -1; sideDistX = (px - mapX) * deltaDistX; }
      else { stepX = 1; sideDistX = (mapX + 1.0 - px) * deltaDistX; }
      if (rayDirY < 0) { stepY = -1; sideDistY = (py - mapY) * deltaDistY; }
      else { stepY = 1; sideDistY = (mapY + 1.0 - py) * deltaDistY; }

      var side = 0, steps = 0, lim = maxSteps || 32;
      while (steps++ < lim) {
        if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
        else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
        if (mapY < 0 || mapY >= gridRows.length || mapX < 0 || mapX >= gridRows[mapY].length) {
          return { hit: false, dist: lim, side: side, tile: "#" };
        }
        var tile = gridRows[mapY].charAt(mapX);
        if (tile !== "." && tile !== "P") {
          var dist = side === 0 ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY);
          return { hit: true, dist: Math.max(0.05, dist), side: side, tile: tile, mapX: mapX, mapY: mapY };
        }
      }
      return { hit: false, dist: lim, side: side, tile: "." };
    }
  };

  root.Evelyn3D = {
    parseOBJ: parseOBJ,
    exportOBJ: exportOBJ,
    makeCube: makeCube,
    makeGlider: makeGlider,
    Camera3D: Camera3D,
    SoftwareRenderer3D: SoftwareRenderer3D,
    Raycaster25D: Raycaster25D
  };
})(typeof window !== "undefined" ? window : global);
