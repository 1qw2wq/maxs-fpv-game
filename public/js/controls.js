// Pointer lock, mouse look and client-authoritative movement.
//
// Movement is simulated locally for a responsive feel, but every value that
// matters (fire rate, ammo, damage, kill) is decided by the server. Collision
// uses the exact same rules as server/combat.py so the two cannot disagree
// about where a wall is.

import * as THREE from 'three';
import { yawToRotation } from './character.js';
import { MouseLook } from './mouse-look.js';

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
    this._jumpHeld = false;
    this._jumpBuffer = 0;
    this._coyote = 0;

    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.ads = false;
    this._aimHeld = false;
    this.lookFov = 78;
    this.crouch = false;
    this.sprinting = false;
    this.touchSprintAt = null;
    this.inputNow = () => performance.now();
    this.moveSpeed = 0;
    this.enabled = false;
    this.locked = false;
    this.mobileMode = false;
    this.touchActive = false;
    this.touchFirePending = false;
    this.touchMove = { x: 0, y: 0 };
    this.touchKeys = new Set();
    this.onInputReset = null;
    // Set once pointer lock has actually been refused (see _lockFailed): only
    // then is the page worth telling the player about.
    this.lockUnavailable = false;
    this._wantLook = false;

    this.sensitivity = 0.0022;
    this.mouseLook = new MouseLook();
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
      if (this.mobileMode || !this.enabled || typing()) return;
      if (e.button === 2) this._aimHeld = true;
      if (!this.canLook) { this.requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.onFireDown?.(); }
      if (e.button === 2) { this.mouse.right = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (this.mobileMode) return;
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) { this.mouse.right = false; this._aimHeld = false; }
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (this.mobileMode || !this.canLook || !this.enabled || typing()) return;
      // yaw grows clockwise (0 = +X, 90 = +Z), so mouse-right must add.
      // Match screen-space precision to the actual zoom, including transitions.
      const fov = Math.max(10, Math.min(78, this.lookFov || 78));
      const zoomScale = Math.tan(fov * Math.PI / 360) / Math.tan(78 * Math.PI / 360);
      const k = this.sensitivity * 57.2958 * zoomScale;
      this.mouseLook.push(e.movementX, e.movementY, k);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === c && (!this._wantLook || !this.enabled)) {
        document.exitPointerLock?.();
        return;
      }
      this.locked = document.pointerLockElement === this.canvas;
      this.mouseLook.reset();
      clearTimeout(this._lockWatch);
      this._lockPending = false;
      this._lockRequestId += 1;
      if (this.locked) {
        this.lockUnavailable = false;
        this.mouse.right = this._aimHeld;
      } else {
        this._wantLook = false;
        this._lockCooldownUntil = Math.max(this._lockCooldownUntil, performance.now() + 1300);
        this.mouse.left = false;
        this.mouse.right = false;
        this._aimHeld = this.ads = false;
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
    window.addEventListener('resize', () => {
      this.mouseLook.reset();
      if (this.mobileMode) this.releaseLook();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseLook();
    });
  }

  /** True only while the player has explicitly taken control of the view. */
  get canLook() {
    return this.mobileMode ? this.enabled && this.touchActive : this.locked;
  }

  setMobileMode(enabled) {
    if (this.mobileMode === !!enabled) return;
    this.releaseLook();
    this.mobileMode = !!enabled;
    this.lockUnavailable = false;
  }

  /** Explicit touch mode only; mouse deltas never use this path. */
  touchLook(dx, dy) {
    if (!this.mobileMode || !this.canLook || typing()) return;
    const fov = Math.max(10, Math.min(78, this.lookFov || 78));
    const zoom = Math.tan(fov * Math.PI / 360) / Math.tan(78 * Math.PI / 360);
    // Touch coordinates are CSS pixels, independent of DPR/render resolution.
    this.mouseLook.push(dx, dy, this.sensitivity * 57.2958 * 2 * zoom);
  }

  requestLock() {
    if (this.mobileMode) {
      if (this.enabled) this.touchActive = true;
      return;
    }
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
    this._aimHeld = this.ads = this.mouse.right = false;
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
    this.sprinting = false; this.touchSprintAt = null;
    this.touchActive = false;
    this.touchFirePending = false;
    this.touchMove.x = this.touchMove.y = 0;
    this.touchKeys.clear();
    this.onInputReset?.();
    this.mouseLook.reset();
    clearTimeout(this._lockWatch);
    this._wantLook = false;
    this._lockPending = false;
    this._lockRequestId += 1;
    this._lockCooldownUntil = performance.now() + 1300;
    this.keys.clear();
    this._jumpHeld=false;this._jumpBuffer=this._coyote=0;
    this.mouse.left = false;
    this.mouse.right = false;
    this._aimHeld = this.ads = false;
    this.onAbilityCancel?.();
    const hadLock = this.locked || document.pointerLockElement === this.canvas;
    // exitPointerLock completes asynchronously. Stop accepting deltas now,
    // rather than allowing one final packet into the pause/relock transition.
    this.locked = false;
    if (hadLock) document.exitPointerLock?.();
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

  /** Retain a short touch press until physics sees it, even between frames. */
  queueJump() {
    if (this.enabled && !typing()) this._jumpBuffer = .12;
  }

  setClass(cls) {
    this.speedMult = cls.speedMult;
    this.eyeStand = this.combat.standEyeHeight;
    this.eyeCrouch = this.combat.crouchEyeHeight;
  }

  reset(pos, yaw) {
    this.sprinting = false; this.touchSprintAt = null;
    if (this.mobileMode) {
      this.releaseLook();
      this.requestLock();
    }
    this.mouseLook.reset();
    this.pos.set(pos[0], pos[1], pos[2]);
    this.eyeGround = pos[1];
    this.yaw = yaw ?? this.yaw;
    this.pitch = 0;
    this.vy = 0;
    this.grounded = true;
    this.vel.set(0, 0, 0);
    this._jumpHeld=false;this._jumpBuffer=this._coyote=0;
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

  // Called before camera placement AND fire processing: filtered aim and the
  // crosshair share one orientation, including while zoomed or in third person.
  updateMouseLook(dt) {
    if (!this.enabled || !this.canLook || typing()) { this.mouseLook.reset(); return; }
    const delta = this.mouseLook.consume(dt);
    this.yaw = ((this.yaw + delta.yaw) % 360 + 360) % 360;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + delta.pitch));
    if (Math.abs(this.pitch) === PITCH_LIMIT) this.mouseLook.pitch = 0;
  }

  update(dt, alive, suppressed, reloading = false) {
    if (alive) this.updateMouseLook(dt); else this.mouseLook.reset();
    if (!this.world) return;
    // Ease the *camera* ground height. Vertical speed is unbounded on a jump or
    // a fall, so those track instantly; walking and stairs use a slow constant
    // that filters the few centimetres a tread or a cobble adds -- which is the
    // chatter that used to reach the view. The body is never touched.
    const vup = Math.abs(this.pos.y - this.eyeGround);
    const ease = 1 - Math.exp(-(vup > 0.6 ? 40 : 12) * dt);
    this.eyeGround += (this.pos.y - this.eyeGround) * ease;

    const k = this.keys;
    const wantsCrouch = k.has('KeyC') || k.has('ControlLeft') || k.has('ControlRight') || this.touchKeys.has('KeyC');
    // Refuse to stand up where the head would hit geometry: a body that crouched
    // into a low passage stays crouched on release instead of getting wedged.
    const canStand = !this.world.blocked(this.pos.x, this.pos.z, this.pos.y,
      this.combat.playerHeight);
    const wasCrouch = this.crouch;
    this.crouch = wantsCrouch || !canStand;
    // Stance changes get their own click so crouching never feels silent.
    if (this.enabled && this.crouch !== wasCrouch) this.onStance?.(this.crouch);
    this.ads = this.mouse.right && this.canLook && alive && this.enabled && !typing() && !reloading;

    if (!alive || !this.enabled) {
      this.moveSpeed = 0;
      this.sprinting = false; this.touchSprintAt = null;
      this.vel.set(0,0,0);
      this._jumpBuffer = this._coyote = 0;
      this._jumpHeld = false;
      return;
    }
    // Arrow-key look is driven from the frame loop, but never while the chat
    // box has the keyboard.
    if (!typing()) {
      this._arrowLook(dt);
    }

    let fx = 0, fz = 0;
    const canMove = !typing();
    if (canMove && k.has('KeyW')) fx += 1;
    if (canMove && k.has('KeyS')) fx -= 1;
    if (canMove && k.has('KeyD')) fz += 1;
    if (canMove && k.has('KeyA')) fz -= 1;
    if (canMove && this.mobileMode && this.canLook) {
      fx += this.touchMove.y; fz += this.touchMove.x;
    }
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }

    const touchRun = this.mobileMode && this.canLook && Math.hypot(this.touchMove.x,this.touchMove.y) > .1 && !this.ads && !this.crouch && canMove;
    if (!touchRun) this.touchSprintAt = null;
    else if (this.touchSprintAt === null) this.touchSprintAt = this.inputNow() + 1500;
    this.sprinting = canMove && len > .1 && !this.ads && !this.crouch &&
      (k.has('ShiftLeft') || k.has('ShiftRight') || (touchRun && this.inputNow() >= this.touchSprintAt));
    let speed = this.combat.maxMoveSpeed * this.speedMult;
    if (this.sprinting) speed *= this.combat.sprintMult || 1.35;
    if (this.crouch) speed *= 0.55;
    if (this.ads) speed *= this.combat.adsMoveMult || .62;
    if (suppressed) speed *= 0.92;

    const yawRad = (this.yaw * Math.PI) / 180;
    // forward = (cos yaw, 0, sin yaw); screen-right = cross(forward, up)
    const wishX = Math.cos(yawRad) * fx - Math.sin(yawRad) * fz;
    const wishZ = Math.sin(yawRad) * fx + Math.cos(yawRad) * fz;

    // Exponential response is consistent at 30/60/144 Hz. A single release
    // curve brakes without the old double damping or instant low-FPS snaps.
    const accel = this.grounded ? (len === 0 ? 22 : 18) : 5.5;
    const blend = 1-Math.exp(-accel*dt);
    this.vel.x += (wishX*speed-this.vel.x)*blend;
    this.vel.z += (wishZ*speed-this.vel.z)*blend;
    if (len === 0 && Math.hypot(this.vel.x,this.vel.z)<0.015) this.vel.set(0,0,0);

    // Edge-triggered jump with a small buffer and coyote window. Holding Space
    // no longer auto-bounces on every landing; chat/blur cannot queue a jump.
    const jump=canMove && (k.has('Space') || this.touchKeys.has('Space'));
    this._jumpBuffer = jump && !this._jumpHeld ? .12 : Math.max(0,this._jumpBuffer-dt);
    this._jumpHeld = jump;
    this._coyote = this.grounded ? .1 : Math.max(0,this._coyote-dt);
    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.vy = this.combat.jumpSpeed;
      this.grounded = false;
      this._jumpBuffer = this._coyote = 0;
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
