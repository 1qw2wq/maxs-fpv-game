import * as THREE from 'three';

// Presentation only: immunity and expiry always come from the match host.
// Each avatar owns its resources, so its normal destroy() also disposes these.
export function updateSpawnShield(girl, active, now = performance.now()) {
  if (!girl) return;
  let mesh = girl.spawnShield;
  if (!active) {
    if (mesh) {
      girl.root.removeEventListener('removed', mesh.userData.cleanup);
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      girl.spawnShield = null;
    }
    return;
  }
  if (!mesh) {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12),
      new THREE.MeshBasicMaterial({ color: 0x61d9ff, transparent: true, opacity: .16,
        wireframe: true, depthWrite: false }));
    mesh.name = 'spawn-protection';
    mesh.position.y = .88;
    mesh.scale.set(.7, 1.05, .7);
    mesh.userData.cleanup = () => updateSpawnShield(girl, false);
    girl.root.addEventListener('removed', mesh.userData.cleanup);
    girl.root.add(mesh);
    girl.spawnShield = mesh;
  }
  mesh.material.opacity = .18 + .05 * Math.sin(now * .006);
}
