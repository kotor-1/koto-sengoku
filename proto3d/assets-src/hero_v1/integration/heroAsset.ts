/** Integration example. Not yet exercised in the user's existing project.
 * It only supplies a visual model; retain the existing movement/collision code.
 */
import { AnimationMixer, Group, LoopRepeat, Mesh, type AnimationAction, type Material, type Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

type ClipName = 'Idle' | 'Walk' | 'Run';
interface WebModel { format: string; base64: string }
export interface HeroAsset {
  root: Group;
  update: (deltaSeconds: number, actualSpeedMps: number, runSelected: boolean) => void;
  dispose: () => void;
}

/** For .web.json, pass the directory containing textures/ as resourceBase.
 * Never construct a data: URL for GLTFLoader. The binary is decoded locally.
 */
export async function loadHeroAsset(url: string, resourceBase?: string): Promise<HeroAsset> {
  const loader = new GLTFLoader();
  let gltf: GLTF;
  const absolute = new URL(url, window.location.href);
  if (absolute.pathname.endsWith('.json')) {
    const response = await fetch(absolute.href);
    if (!response.ok) throw new Error(`Hero model HTTP ${response.status}`);
    const bundle = await response.json() as WebModel;
    if (bundle.format !== 'glb-base64-external-images-v1' || typeof bundle.base64 !== 'string') {
      throw new Error('Unexpected hero JSON format');
    }
    const text = atob(bundle.base64);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    const base = resourceBase ?? new URL('.', absolute).href;
    gltf = await new Promise<GLTF>((resolve, reject) => loader.parse(bytes.buffer, base, resolve, reject));
  } else {
    if (resourceBase) loader.setResourcePath(resourceBase);
    gltf = await loader.loadAsync(absolute.href);
  }

  const root = gltf.scene;
  const mixer = new AnimationMixer(root);
  const actions = new Map<ClipName, AnimationAction>();
  for (const name of ['Idle', 'Walk', 'Run'] as const) {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`Missing ${name} animation`);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopRepeat, Infinity);
    actions.set(name, action);
  }
  root.traverse(object => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      // One hero only: avoid stale skinned bounds while integration is checked.
      object.frustumCulled = false;
    }
  });
  let current: ClipName = 'Idle';
  actions.get(current)!.play();
  let disposed = false;
  return {
    root,
    update(delta, actualSpeed, runSelected) {
      if (disposed || !Number.isFinite(delta) || delta < 0) return;
      const speed = Number.isFinite(actualSpeed) ? Math.max(0, actualSpeed) : 0;
      const next: ClipName = speed < 0.06 ? 'Idle' : runSelected && speed > 1.8 ? 'Run' : 'Walk';
      if (next !== current) {
        const previous = actions.get(current)!;
        const action = actions.get(next)!;
        action.reset().setEffectiveWeight(1).play();
        previous.crossFadeTo(action, 0.18, false);
        current = next;
      }
      const referenceSpeed = current === 'Run' ? 3.0 : 1.4;
      actions.get(current)!.setEffectiveTimeScale(current === 'Idle' ? 1 : Math.max(0.2, Math.min(2, speed / referenceSpeed)));
      mixer.update(delta);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      const materials = new Set<Material>();
      const textures = new Set<Texture>();
      root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture === true) textures.add(value as Texture);
        }
        material.dispose();
      }
      textures.forEach(texture => texture.dispose());
      root.removeFromParent();
    },
  };
}
