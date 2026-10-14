// Pointer lock, mouse look and client-authoritative movement.
//
// Movement is simulated locally for a responsive feel, but every value that
// matters (fire rate, ammo, damage, kill) is decided by the server. Collision
// uses the exact same rules as server/combat.py so the two cannot disagree
// about where a wall is.

import * as THREE from 'three';
import { yawToRotation } from './character.js';

const PITCH_LIMIT = 88;

// Pointer lock is the normal way to look around, but it is not always granted:
// a page embedded in an iframe that lacks the pointer-lock permission, or a
// sandboxed preview pane, is refused outright -- there is no permission prompt
// to accept, requestPointerLock() just fails. Before this fallback existed the
// mouse did nothing at all in those frames, so the game looked broken (aim and
// fire both dead) even though everything else worked. When lock is refused the
// controls switch to "steer" look instead:
//
//   * the view turns while the cursor is pushed away from the middle of the
//     screen: left/right of centre yaws, near the top or bottom edge pitches;
//   * holding either mouse button drags the aim directly, like a touchpad, for
//     the precision shots (this works while firing, so aiming never stops);
//   * the arrow keys turn as well.
//
// Fire, ADS, crouch, jump, reload and abilities are untouched by the fallback.
const STEER_YAW_RATE = 165;      // deg/s at full deflection
const STEER_PITCH_RATE = 105;
const STEER_DEADZONE_X = 0.16;   // fraction of the half-width that never turns
const STEER_DEADZONE_Y = 0.42;   // middle band is aim-safe: only the edges pitch
const DRAG_LOOK_SCALE = 1.35;
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
    // Pointer lock refused -> cursor steering (see the notes at the top).
    this.steer = false;
    this.pointerX = 0;
    this.pointerY = 0;
    this.pointerInside = false;

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
    // Fired with 'steer' the moment pointer lock turns out to be unavailable.
    this.onLookMode = null;

    this._lockWatch = null;
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
      // Cursor position drives steer look, so it is tracked in every mode.
      if (typeof e.clientX === 'number') {
        this.pointerX = e.clientX;
        this.pointerY = e.clientY;
        this.pointerInside = true;
      }
      if (!this.canLook || !this.enabled || typing()) return;
      // Steered look only reads raw deltas while a button is held (drag-look);
      // otherwise the cursor position steers it from update().
      if (this.steer && !(this.mouse.left || this.mouse.right)) return;
      // yaw grows clockwise (0 = +X, 90 = +Z), so mouse-right must add.
      const k = this.sensitivity * 57.2958 * (this.steer ? DRAG_LOOK_SCALE : 1);
      this.yaw += e.movementX * k;
      this.pitch -= e.movementY * k;
      this.yaw = ((this.yaw % 360) + 360) % 360;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });
    // The cursor leaving the window must stop the turn: a stale position would
    // otherwise keep the view spinning at full rate with no way to stop it.
    window.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget) this.pointerInside = false;
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
    // Fired by browsers that refuse the lock request; some also reject the
    // promise, so both paths funnel into the same fallback.
    document.addEventListener('pointerlockerror', () => this._lockFailed());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this.onScoreboard?.(true); return; }
      if (e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.enabled || typing()) return;
      // Esc always hands the mouse back, in both look modes (see releaseLook).
      if (e.code === 'Escape') { this.releaseLook(); return; }
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
      this.pointerInside = false;
      this.onAbilityCancel?.();
    });
  }

  /** True when the mouse can turn the view: either locked or steered. */
  get canLook() {
    return this.locked || this.steer;
  }

  requestLock() {
    if (this.steer || this.locked) return;
    const el = this.canvas;
    if (!el || typeof el.requestPointerLock !== 'function') { this._lockFailed(); return; }
    try {
      const pending = el.requestPointerLock();
      // Chrome/Edge return a promise whose rejection carries the reason
      // ("frame is sandboxed and the 'allow-pointer-lock' permission is not
      // set", or a permissions-policy refusal).
      if (pending && typeof pending.catch === 'function') {
        pending.catch(() => this._lockFailed());
      }
    } catch (err) {
      this._lockFailed();
      return;
    }
    // Firefox and Safari may fail silently, so cover that with a short
    // watchdog: still unlocked a moment later means it will never be granted.
    clearTimeout(this._lockWatch);
    this._lockWatch = setTimeout(() => {
      if (document.pointerLockElement !== el) this._lockFailed();
    }, 900);
  }

  /**
   * Pointer lock is unavailable here. Turn on cursor steering instead of
   * leaving the player with a dead mouse, and let the HUD explain the switch.
   */
  _lockFailed() {
    clearTimeout(this._lockWatch);
    // Refused because the player just pressed Esc (Chrome holds the mouse for a
    // moment after): that is not a verdict on this page, so stay out of the way
    // and let them click again.
    if (performance.now() < this._lockCooldownUntil) return;
    if (this.steer) return;
    this.steer = true;
    this.mouse.left = false;
    this.mouse.right = false;
    this.pointerInside = false;
    this.onLookMode?.('steer');
  }

  releaseLock() {
    clearTimeout(this._lockWatch);
    document.exitPointerLock?.();
  }

  /**
   * Esc: give the mouse back.
   *
   * The locked case is the browser's own doing -- Esc exits pointer lock and
   * the pointerlockchange handler cleans up -- except that Chrome then refuses
   * another lock for about a second, and *that* refusal used to be read as
   * "pointer lock is unavailable here", which dropped the player into cursor
   * steering they had not asked for.
   *
   * The steered case had no way out at all: Esc does nothing while there is no
   * lock to exit, so the view kept turning with the cursor and the only exit
   * was reloading the page. Here it is deliberate: steering off, keys and
   * buttons released, and the "click to continue" prompt comes back -- clicking
   * re-locks if this environment allows it, and re-enters steering if it does
   * not.
   */
  releaseLook() {
    clearTimeout(this._lockWatch);
    this._lockCooldownUntil = performance.now() + 1300;
    this.keys.clear();
    this.mouse.left = false;
    this.mouse.right = false;
    this.onAbilityCancel?.();
    const steered = this.steer;
    if (steered) {
      this.steer = false;
      this.pointerInside = false;
      this.onLookMode?.('free');
    }
    if (this.locked || document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
  }

  // ------------------------------------------------------------ steer look

  /** Turn the view from the cursor's offset from the middle of the screen. */
  _steerLook(dt) {
    const w = innerWidth || 1;
    const h = innerHeight || 1;
    const nx = this.pointerInside ? (this.pointerX / w) * 2 - 1 : 0;
    const ny = this.pointerInside ? (this.pointerY / h) * 2 - 1 : 0;
    this.yaw += ramp(nx, STEER_DEADZONE_X) * STEER_YAW_RATE * dt;
    this.pitch -= ramp(ny, STEER_DEADZONE_Y) * STEER_PITCH_RATE * dt;

    // Arrow keys: the same turn, at a constant rate, for players who cannot
    // push the cursor to the far edge of a small window.
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
    // Steered look is driven from the frame loop (the cursor itself is the
    // input), but never while the chat box has the keyboard.
    if (this.steer && !typing()) this._steerLook(dt);

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

/**
 * Deflection curve for steered look: nothing inside the dead zone, then a
 * smooth-step ramp so small offsets aim gently and the edges turn fast.
 */
function ramp(v, dead) {
  const a = Math.abs(v);
  if (a <= dead) return 0;
  const t = Math.min(1, (a - dead) / (1 - dead));
  return Math.sign(v) * t * t * (3 - 2 * t);
}
