/* evelyn_visual_craft.js - task-agnostic three.js visual craft for Evelyn's code loop.
   Three parts, all plain ES5 with no dependencies:
     1. THREE_VISUAL_CRAFT_NOTES: two reusable shelf records (lighting contrast, atmosphere and framing) for an
        OffsetShelfStore or a SkillShelfStore, written with no task-specific numbers from any benchmark check.
     2. VISUAL_SYSTEM: a system prompt that keeps every API name, count and constraint strict and asks for visual quality
        inside them.
     3. verifySceneVisuals(THREE, scene, camera, opts): a deterministic scene-graph check (no WebGL, no model) that
        returns an array of actionable error strings; an empty array means it passed.
   The check measures the scene graph only. It does not look at pixels, so it cannot tell that a picture is good. */
(function (root) {
  "use strict";

  var THREE_VISUAL_CRAFT_NOTES = [
    {
      shelf: "craft",
      topic: "threejs lighting contrast shading",
      fullText:
        "For dramatic 3D shading in Three.js, pair a strong key light (PointLight or DirectionalLight, intensity 2.5 to 4.0, " +
        "use decay=0 on PointLight for large scenes) with a weak AmbientLight (intensity 0.08 to 0.15) so shadowed sides stay dark. " +
        "Use MeshStandardMaterial with varied roughness (0.35 to 0.9) on lit objects; reserve MeshBasicMaterial only for self-lit light sources."
    },
    {
      shelf: "craft",
      topic: "threejs atmosphere glow starfield framing",
      fullText:
        "Give Three.js scenes depth and strong composition: set renderer.toneMapping = THREE.ACESFilmicToneMapping; " +
        "use a deep scene.background color; add depth with THREE.Points (starfield/dust) or THREE.FogExp2 (landscapes). " +
        "For glowing suns or halos, use a THREE.Sprite with a soft radial canvas texture and AdditiveBlending instead of an extra Mesh sphere. " +
        "Place the camera so the hero subject fills 55% to 70% of the viewport."
    }
  ];

  var VISUAL_SYSTEM =
    "You are a senior graphics engineer and technical artist. " +
    "Obey every API name, object count, and functional constraint in the verified notes strictly. " +
    "Within those constraints, maximize visual quality: strong key-to-ambient lighting contrast for crisp shading, " +
    "rich materials, atmospheric depth (starfields via THREE.Points, fog, or soft radial THREE.Sprite glow instead of extra meshes), " +
    "clean visible guide lines, and camera framing where the subject fills ~60-70% of the viewport. " +
    "Reply with the complete code in one fenced block.";

  /* opts.requireAtmosphere (default true), opts.minFill (default 0.38), opts.maxAmbientRatio (default 0.35).
     Returns an array of error strings. */
  function verifySceneVisuals(THREE, scene, camera, opts) {
    opts = opts || {};
    var minFill = opts.minFill === undefined ? 0.38 : opts.minFill;
    var maxAmbient = opts.maxAmbientRatio === undefined ? 0.35 : opts.maxAmbientRatio;
    var errors = [];
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();

    var keyMax = 0, ambientSum = 0, litMeshes = 0, basicMeshes = 0, hasAtmosphere = false;
    var heroBox = new THREE.Box3(), hasHero = false;

    scene.traverse(function (obj) {
      if (obj.isAmbientLight || obj.isHemisphereLight) {
        ambientSum += (obj.intensity !== undefined ? obj.intensity : 1);
      } else if (obj.isPointLight || obj.isDirectionalLight || obj.isSpotLight) {
        var inten = obj.intensity !== undefined ? obj.intensity : 1;
        if (inten > keyMax) keyMax = inten;
      }
      if (obj.isPoints || obj.isSprite) hasAtmosphere = true;

      if (obj.isMesh && obj.geometry) {
        var mat = obj.material;
        if (mat) {
          if (mat.isMeshBasicMaterial) basicMeshes++;
          else litMeshes++;
        }
        /* a giant sky dome (BackSide) is not the hero subject */
        if (!mat || mat.side !== THREE.BackSide) {
          heroBox.expandByObject(obj);
          hasHero = true;
        }
      }
    });

    if (scene.fog) hasAtmosphere = true;

    if (keyMax <= 0) {
      errors.push("Visual check: scene has no PointLight, DirectionalLight, or SpotLight; add a key light for 3D shading.");
    } else if (ambientSum > keyMax * maxAmbient) {
      errors.push(
        "Visual check: ambient/hemisphere light (" + ambientSum.toFixed(2) +
        ") is too strong compared to key light (" + keyMax.toFixed(2) +
        "); lower ambient to <= 0.15 * key for crisp light/shadow contrast."
      );
    }

    if (litMeshes === 0 && basicMeshes > 0) {
      errors.push("Visual check: all meshes use flat MeshBasicMaterial; use MeshStandardMaterial or MeshPhongMaterial on lit objects.");
    }

    if (opts.requireAtmosphere !== false && !hasAtmosphere) {
      errors.push("Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.");
    }

    /* framing: project the 8 corners of the hero Box3 into NDC [-1, 1] */
    if (hasHero && !heroBox.isEmpty()) {
      var mn = heroBox.min, mx = heroBox.max;
      var corners = [
        new THREE.Vector3(mn.x, mn.y, mn.z), new THREE.Vector3(mn.x, mn.y, mx.z),
        new THREE.Vector3(mn.x, mx.y, mn.z), new THREE.Vector3(mn.x, mx.y, mx.z),
        new THREE.Vector3(mx.x, mn.y, mn.z), new THREE.Vector3(mx.x, mn.y, mx.z),
        new THREE.Vector3(mx.x, mx.y, mn.z), new THREE.Vector3(mx.x, mx.y, mx.z)
      ];
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, i, c;
      for (i = 0; i < corners.length; i++) {
        c = corners[i].project(camera);
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }
      var fillW = (Math.min(1, maxX) - Math.max(-1, minX)) / 2;
      var fillH = (Math.min(1, maxY) - Math.max(-1, minY)) / 2;
      var maxFill = Math.max(fillW, fillH);
      if (maxFill < minFill) {
        errors.push(
          "Visual check: hero subject fills only " + Math.round(Math.max(0, maxFill) * 100) +
          "% of viewport; move camera closer so it fills ~55-70%."
        );
      }
    }
    return errors;
  }

  var API = {
    THREE_VISUAL_CRAFT_NOTES: THREE_VISUAL_CRAFT_NOTES,
    VISUAL_SYSTEM: VISUAL_SYSTEM,
    verifySceneVisuals: verifySceneVisuals
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynVisualCraft = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
