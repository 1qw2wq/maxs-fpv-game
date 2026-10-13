// Pointer lock, mouse look and client-authoritative movement.
//
// Movement is simulated locally for a responsive feel, but every value that
// matters (fire rate, ammo, damage, kill) is decided by the server. Collision
// uses the exact same rules as server/combat.py so the two cannot disagree
// about where a wall is.

import * as THREE from 'three';
import { yawToRotation } from './character.js';

const PITCH_LIMIT = 88;

export class Controls {
  constructor(canvas, world, combat, data) {
    this.canvas = canvas;
    this.world = world;
    this.combat = combat;
    this.data = data;

    // The World is built lazily (a 92 MB model map must not delay the menu), so
    // boot passes null and setMap() fills it in before the first deploy.
    this.pos = new THREE.Vector3(0, world?.groundY ?? 0, 0);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    // Smooths the *camera* onto the ground height only; the body itself is still
    // snapped every frame, so collision never lags. This is what stops the
    // handful of centimetres a stair tread or a cobble adds from being passed
    // straight to the view as a visible jolt.
    this.eyeGround = world?.groundY ?? 0;
    this.yaw = 0;          // degrees, 0 = +X
    this.pitch = 0;        // degrees, + = up
    this.grounded = true;

    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.ads = false;
    this.crouch = false;
    this.moveSpeed = 0;
    this.enabled = false;
    this.locked = false;

    this.sensitivity = 0.0022;
    this.speedMult = 1;

    this.onFireDown = null;
    this.onReload = null;
    // Q is held to charge a throw: down opens the aim preview, up releases it.
    this.onAbilityDown = null;
    this.onAbilityUp = null;
    // Charge dropped without a throw (lost lock, tab blur, death).
    this.onAbilityCancel = null;
    this.onScoreboard = null;
    this.onChat = null;
    this.onViewToggle = null;
    this.onLockChange = null;

    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.onFireDown?.(); }
      if (e.button === 2) { this.mouse.right = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // yaw grows clockwise (0 = +X, 90 = +Z), so mouse-right must add.
      this.yaw += e.movementX * this.sensitivity * 57.2958;
      this.pitch -= e.movementY * this.sensitivity * 57.2958;
      this.yaw = ((this.yaw % 360) + 360) % 360;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouse.left = false;
        this.mouse.right = false;
        this.keys.clear();
        this.onAbilityCancel?.();
      }
      this.onLockChange?.(this.locked);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this.onScoreboard?.(true); return; }
      if (!this.enabled) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.onReload?.();
      if (e.code === 'KeyQ') this.onAbilityDown?.();
      if (e.code === 'KeyV') this.onViewToggle?.();
      if (e.code === 'Enter') this.onChat?.();
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') { this.onScoreboard?.(false); return; }
      if (e.code === 'KeyQ') this.onAbilityUp?.();
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = false;
      this.onAbilityCancel?.();
    });
  }

  requestLock() {
    this.canvas.requestPointerLock?.();
  }

  releaseLock() {
    document.exitPointerLock?.();
  }

  setClass(cls) {
    this.speedMult = cls.speedMult;
    this.eyeStand = this.combat.standEyeHeight;
    this.eyeCrouch = this.combat.crouchEyeHeight;
  }

  reset(pos, yaw) {
    this.pos.set(pos[0], pos[1], pos[2]);
    this.eyeGround = pos[1];
    this.yaw = yaw ?? this.yaw;
    this.pitch = 0;
    this.vy = 0;
    this.vel.set(0, 0, 0);
  }

  get eyeY() {
    return this.crouch ? this.eyeCrouch : this.eyeStand;
  }

  /** Collision capsule height: the crouched body is shorter, so it fits low gaps. */
  get bodyHeight() {
    return this.crouch ? this.combat.crouchHeight : this.combat.playerHeight;
  }

  eye(out = new THREE.Vector3()) {
    // Camera rides the eased ground height (see update); the body/collision
    // itself always sits on the exact surface.
    return out.set(this.pos.x, this.eyeGround + this.eyeY, this.pos.z);
  }

  /** Unit forward vector, matching the server's dir_from_angles. */
  aim(out = new THREE.Vector3()) {
    const y = (this.yaw * Math.PI) / 180;
    const p = (this.pitch * Math.PI) / 180;
    const cp = Math.cos(p);
    return out.set(Math.cos(y) * cp, Math.sin(p), Math.sin(y) * cp).normalize();
  }

  update(dt, alive, suppressed) {
    if (!this.world) return;
    // Ease the *camera* ground height. Vertical speed is unbounded on a jump or
    // a fall, so those track instantly; walking and stairs use a slow constant
    // that filters the few centimetres a tread or a cobble adds -- which is the
    // chatter that used to reach the view. The body is never touched.
    const vup = Math.abs(this.pos.y - this.eyeGround);
    const ease = 1 - Math.exp(-(vup > 0.6 ? 40 : 12) * dt);
    this.eyeGround += (this.pos.y - this.eyeGround) * ease;

    const k = this.keys;
    const wantsCrouch = k.has('ShiftLeft') || k.has('ShiftRight');
    // Refuse to stand up where the head would hit geometry: a body that crouched
    // into a low passage stays crouched on release instead of getting wedged.
    const canStand = !this.world.blocked(this.pos.x, this.pos.z, this.pos.y,
      this.combat.playerHeight);
    const wasCrouch = this.crouch;
    this.crouch = wantsCrouch || !canStand;
    // Stance changes get their own click so crouching never feels silent.
    if (this.enabled && this.crouch !== wasCrouch) this.onStance?.(this.crouch);
    this.ads = this.mouse.right;

    if (!alive || !this.enabled) {
      this.moveSpeed = 0;
      return;
    }

    let fx = 0, fz = 0;
    if (k.has('KeyW')) fx += 1;
    if (k.has('KeyS')) fx -= 1;
    if (k.has('KeyD')) fz += 1;
    if (k.has('KeyA')) fz -= 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    let speed = this.combat.maxMoveSpeed * this.speedMult;
    if (this.crouch) speed *= 0.55;
    if (this.ads) speed *= 0.62;
    if (suppressed) speed *= 0.92;

    const yawRad = (this.yaw * Math.PI) / 180;
    // forward = (cos yaw, 0, sin yaw); screen-right = cross(forward, up)
    const wishX = Math.cos(yawRad) * fx - Math.sin(yawRad) * fz;
    const wishZ = Math.sin(yawRad) * fx + Math.cos(yawRad) * fz;

    const accel = this.grounded ? 46 : 13;
    const target = new THREE.Vector3(wishX * speed, 0, wishZ * speed);
    const dvx = (target.x - this.vel.x) * Math.min(1, accel * dt);
    const dvz = (target.z - this.vel.z) * Math.min(1, accel * dt);
    this.vel.x += dvx;
    this.vel.z += dvz;
    if (len === 0 && this.grounded) {
      const damp = Math.min(1, 15 * dt);
      this.vel.x -= this.vel.x * damp;
      this.vel.z -= this.vel.z * damp;
    }

    // gravity + jump
    if (this.grounded && k.has('Space')) {
      this.vy = this.combat.jumpSpeed;
      this.grounded = false;
    }
    this.vy -= this.combat.gravity * dt;

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const [rx, rz] = this.world.resolveMove(this.pos.x, this.pos.z, nx, nz, this.pos.y, this.bodyHeight);
    const [cx, cz] = this.world.clampToBounds(rx, rz);
    // if a wall ate the motion, drop the velocity so we do not stick to it
    if (Math.abs(cx - nx) > 1e-4) this.vel.x = 0;
    if (Math.abs(cz - nz) > 1e-4) this.vel.z = 0;
    this.pos.x = cx;
    this.pos.z = cz;

    let ny = this.pos.y + this.vy * dt;
    // Query the surface under the *new* spot with the body's current height
    // every frame -- nothing is cached, so a surface that has just dropped away
    // can never keep the old height. The query height is the feet themselves, so
    // a low surface is offered as the floor the moment the body is over it.
    const floor = this.world.floorAt(this.pos.x, this.pos.z, this.pos.y);
    if (ny <= floor + 0.001) {
      ny = floor;
      this.vy = 0;
      this.grounded = true;
    } else if (this.grounded && this.vy <= 0 && ny - floor <= this.world.stepUpMax) {
      // Walking down a slope or a low step: stay glued to the surface instead of
      // going briefly airborne on every tread, which is what shook the camera.
      ny = floor;
      this.vy = 0;
    } else {
      // The surface fell away by more than a step: gravity takes over here and
      // the body drops to whatever is underneath.
      this.grounded = false;
    }
    this.pos.y = ny;

    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
  }

  /** Yaw/pitch for a headless spectator ViewModel — unused but kept symmetrical. */
  get rotationY() { return yawToRotation(this.yaw); }
}
