// Pointer lock, mouse look and client-authoritative movement.
//
// Movement is simulated locally for a responsive feel, but every value that
// matters (fire rate, ammo, damage, kill) is decided by the server. Collision
// uses the exact same rules as server/combat.py so the two cannot disagree
// about where a wall is.

import * as THREE from 'three';
import { yawToRotation } from './character.js';

const PITCH_LIMIT = 88;

// Mouse look uses native pointer lock only. Never substitute edge steering or
// drag aiming. A denied request leaves the mouse free and can be retried on a
// later click; parent iframe sandbox permissions cannot be overridden here.
const ARROW_YAW_RATE = 135;
const ARROW_PITCH_RATE = 95;

/** True while a text field has focus (chat box): game keys and look must idle. */
function typing() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

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
    // Set once pointer lock has actually been refused (see _lockFailed): only
    // then is the page worth telling the player about.
    this.lockUnavailable = false;
    this._wantLook = false;

    this.sensitivity = 0.0022;
    this.speedMult = 1;

    this.onFireDown = null;
    this.onReload = null;
    // Q is held to charge a throw: down opens the aim preview, up releases it.
    this.onAbilityDown = null;
    this.onAbilityUp = null;
    this.onGrenadeDown = null;
    this.onGrenadeUp = null;
    this.onGrenadeCycle = null;
    // Charge dropped without a throw (lost lock, tab blur, death).
    this.onAbilityCancel = null;
    this.onScoreboard = null;
    this.onChat = null;
    this.onViewToggle = null;
    this.onLockChange = null;
    // Fired with 'unavailable' when the browser refuses the lock, and with
    // 'free' when the mouse is handed back.
    this.onLookMode = null;
    // Esc was pressed during a match: the game opens its pause menu here (the
    // mouse itself has already been handed back by releaseLook).
    this.onEscape = null;

    this._lockWatch = null;
    this._lockPending = false;
    this._lockRequestId = 0;
    // A lock request right after the player pressed Esc is refused by Chrome
    // for about a second; that refusal must not be mistaken for "this page
    // cannot lock the mouse" (see _lockFailed).
    this._lockCooldownUntil = 0;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.canLook) { this.requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.onFireDown?.(); }
      if (e.button === 2) { this.mouse.right = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.canLook || !this.enabled || typing()) return;
      // yaw grows clockwise (0 = +X, 90 = +Z), so mouse-right must add.
      const k = this.sensitivity * 57.2958;
      this.yaw += e.movementX * k;
      this.pitch -= e.movementY * k;
      this.yaw = ((this.yaw % 360) + 360) % 360;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === c && (!this._wantLook || !this.enabled)) {
        document.exitPointerLock?.();
        return;
      }
      this.locked = document.pointerLockElement === this.canvas;
      clearTimeout(this._lockWatch);
      this._lockPending = false;
      this._lockRequestId += 1;
      if (this.locked) {
        this.lockUnavailable = false;
      } else {
        this._wantLook = false;
        this._lockCooldownUntil = Math.max(this._lockCooldownUntil, performance.now() + 1300);
        this.mouse.left = false;
        this.mouse.right = false;
        this.keys.clear();
        this.onAbilityCancel?.();
      }
      this.onLockChange?.(this.locked);
    });
    // Fired by browsers that refuse the lock request; some also reject the
    // promise, so both paths report a failed request without changing controls.
    document.addEventListener('pointerlockerror', () => this._lockFailed());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this.onScoreboard?.(true); return; }
      if (e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.enabled || typing()) return;
      // Esc hands the mouse back (see releaseLook) and opens the pause menu:
      // one key, and the player can carry on, change settings or leave.
      if (e.code === 'Escape') { this.releaseLook(); this.onEscape?.(); return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.onReload?.();
      if (e.code === 'KeyQ') this.onAbilityDown?.();
      if (e.code === 'KeyG') this.onGrenadeDown?.();
      if (e.code === 'KeyB') this.onGrenadeCycle?.();
      if (e.code === 'KeyV') this.onViewToggle?.();
      if (e.code === 'Enter') this.onChat?.();
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') { this.onScoreboard?.(false); return; }
      if (e.code === 'KeyQ') this.onAbilityUp?.();
      if (e.code === 'KeyG') this.onGrenadeUp?.();
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseLook());
  }

  /** True only while the player has explicitly taken control of the view. */
  get canLook() {
    return this.locked;
  }

  requestLock() {
    if (!this.enabled || this.locked || this._lockPending) return;
    // Retrying needs a fresh user gesture, particularly after Esc. Do not
    // schedule an automatic retry that browsers would refuse anyway.
    if (performance.now() < this._lockCooldownUntil) return;
    const el = this.canvas;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    this._wantLook = true;
    this._lockPending = true;
    const requestId = ++this._lockRequestId;
    if (!el || typeof el.requestPointerLock !== 'function') { this._lockFailed(requestId); return; }
    // Cover legacy implementations that return no promise or fail silently.
    clearTimeout(this._lockWatch);
    this._lockWatch = setTimeout(() => {
      if (document.pointerLockElement !== el) this._lockFailed(requestId);
    }, 1500);
    try {
      const pending = el.requestPointerLock();
      if (pending && typeof pending.catch === 'function') {
        pending.catch(() => this._lockFailed(requestId));
      }
    } catch {
      this._lockFailed(requestId);
    }
  }

  /** A denial is not permanent. Every subsequent eligible click can retry. */
  _lockFailed(requestId = this._lockRequestId) {
    if (requestId !== this._lockRequestId || !this._lockPending) return;
    clearTimeout(this._lockWatch);
    this._lockPending = false;
    if (!this.enabled || !this._wantLook || this.locked) return;
    if (!this.lockUnavailable) {
      this.lockUnavailable = true;
      this.onLookMode?.('unavailable');
    }
  }

  releaseLock() {
    this.releaseLook();
  }

  /**
   * Esc: give the mouse back.
   *
   * In a locked game this is the browser's own doing -- Esc exits pointer lock
   * and the pointerlockchange handler cleans up -- except that Chrome then
   * refuses another lock for about a second, and that refusal must not be read
   * as "this page cannot lock the mouse". Here the release is deliberate:
   * keys and buttons are dropped, the "click to continue" prompt comes back,
   * and clicking the view takes the mouse again.
   */
  releaseLook() {
    clearTimeout(this._lockWatch);
    this._wantLook = false;
    this._lockPending = false;
    this._lockRequestId += 1;
    this._lockCooldownUntil = performance.now() + 1300;
    this.keys.clear();
    this.mouse.left = false;
    this.mouse.right = false;
    this.onAbilityCancel?.();
    if (this.locked || document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
    this.onLookMode?.('free');
  }

  // ------------------------------------------------------- keyboard look

  /** Arrow-key look: the same turn the mouse makes, at a constant rate. */
  _arrowLook(dt) {
    const k = this.keys;
    if (k.has('ArrowLeft')) this.yaw -= ARROW_YAW_RATE * dt;
    if (k.has('ArrowRight')) this.yaw += ARROW_YAW_RATE * dt;
    if (k.has('ArrowUp')) this.pitch += ARROW_PITCH_RATE * dt;
    if (k.has('ArrowDown')) this.pitch -= ARROW_PITCH_RATE * dt;

    this.yaw = ((this.yaw % 360) + 360) % 360;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
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
    // Arrow-key look is driven from the frame loop, but never while the chat
    // box has the keyboard.
    if (!typing()) {
      this._arrowLook(dt);
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
    // Sweep the head upward too. Horizontal collision alone lets a jump put
    // the eyes inside a ceiling before the next frame can reject movement.
    if (this.vy > 0) {
      const oldTop = this.pos.y + this.bodyHeight;
      for (const b of this.world._near(this.pos.x, this.pos.z, 0.35)) {
        if (Math.abs(this.pos.x - b.x) >= b.w / 2 + 0.35 || Math.abs(this.pos.z - b.z) >= b.d / 2 + 0.35) continue;
        const underside = b.y - b.h / 2;
        if (underside >= oldTop - 0.001 && ny + this.bodyHeight >= underside) {
          ny = Math.min(ny, underside - this.bodyHeight - 0.002);
          this.vy = 0;
        }
      }
    }
    this.pos.y = ny;

    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
  }

  /** Yaw/pitch for a headless spectator ViewModel — unused but kept symmetrical. */
  get rotationY() { return yawToRotation(this.yaw); }
}
