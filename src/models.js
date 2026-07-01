// models.js — optional rigged GLTF character models for units. A single CC0
// model (RobotExpressive, by Tomás Laulhé / Don McCurdy, public domain) is
// loaded once and cloned per unit, with idle/walk animation. If the load fails
// (e.g. offline), units fall back to their procedural low-poly meshes — the GLTF
// layer is a progressive enhancement, never required.
//
// To add your own characters (from Meshy / Tripo / Mixamo / Quaternius / …): drop
// a rigged `.glb` with Idle + Walking clips into vendor/models/ and register it
// in MODELS below, then set `model: '<key>'` on the unit types in units.js.
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/jsm/utils/SkeletonUtils.js';

const MODELS = {
  robot: { url: './vendor/models/RobotExpressive.glb', scale: 0.42, idle: 'Idle', walk: 'Walking' },
  // Blender-authored low-poly archer (tools/archer.blend.py). Rendered as a
  // squad of three; `tint` recolours the "Owner" material per civ, `flat` gives
  // the faceted low-poly look, `walkAny` plays its (only) clip as the walk cycle.
  archer: { url: './vendor/models/archer.glb', scale: 1.4, tint: true, flat: true, walkAny: true },
};

const loaded = {}; // key -> { gltf, def }

export async function loadUnitModels() {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(MODELS).map(async ([key, def]) => {
    try { loaded[key] = { gltf: await loader.loadAsync(def.url), def }; }
    catch (e) { /* leave unloaded -> procedural fallback */ }
  }));
}

export function hasModel(key) { return !!(key && loaded[key]); }

// Returns { scene, animations, def } with its own cloned scene graph, or null.
export function makeModel(key) {
  const entry = loaded[key];
  if (!entry) return null;
  const scene = cloneSkinned(entry.gltf.scene);
  return { scene, animations: entry.gltf.animations, def: entry.def };
}
