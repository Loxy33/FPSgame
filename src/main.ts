import { loadSettings } from './core/settings';
import { audio } from './core/audio';
import { assets } from './render/assets';
import { Game } from './game';

loadSettings();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const game = new Game();

function fatal(e: unknown) {
  console.error(e);
  const msg = e instanceof Error ? e.message : String(e);
  game.hud.fatal(`启动失败\n\n${msg}\n\n请使用支持 WebGL2 的最新版 Chrome / Edge / Firefox，并确认已启用硬件加速。`);
}

// ?auto=survival | training | cqb | highseas | oilfield (debug only): skip the menu
const auto = debug ? params.get('auto') : null;

game
  .init(
    canvas,
    debug,
    auto === 'survival' ? 'survival' : auto === 'highseas' ? 'highseas' : auto === 'oilfield' ? 'oilfield' : 'training',
  )
  .then(() => {
    if (!debug) return;
    // Developer helpers (only with ?debug): no pointer lock, scripted camera / input.
    const w = window as any;
    w.game = game;
    w.assets = assets;
    w.audio = audio;
    w.wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    w.tp = (x: number, z: number, yaw: number, pitch = 0, y = 0) => {
      const p = game.player;
      p.pos.set(x, y, z);
      p.vel.set(0, 0, 0);
      p.yaw = yaw;
      p.pitch = pitch;
    };
    /** Detached inspection camera with the HUD hidden; cam() with no arguments returns to the player. */
    w.cam = (x?: number, y?: number, z?: number, yaw = 0, pitch = 0, fov = 70, sx?: number, sz?: number) => {
      game.debugCam = x === undefined ? null : { x, y: y!, z: z!, yaw, pitch, fov, sx, sz };
      const hud = document.getElementById('hud');
      if (hud) hud.style.visibility = x === undefined ? '' : 'hidden';
    };
    const timers: Record<string, number> = {};
    w.holdBtn = (b: number, on: boolean) => {
      clearInterval(timers['b' + b]);
      game.input.buttons[b] = on;
      if (on) timers['b' + b] = window.setInterval(() => (game.input.buttons[b] = true), 8);
    };
    w.holdKey = (code: string, on: boolean) => {
      clearInterval(timers[code]);
      const keys = (game.input as any).keys as Set<string>;
      if (on) timers[code] = window.setInterval(() => keys.add(code), 8);
      else keys.delete(code);
    };
    w.tap = (code: string) => ((game.input as any).pressed as Set<string>).add(code);
    w.errors = [] as string[];
    window.addEventListener('error', (e) => w.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => w.errors.push(String(e.reason)));
    if (auto !== null) {
      game.god = !params.has('mortal');
      game.freezeAI = params.has('freeze');
      if (auto === 'cqb') game.start('training', 'cqb');
      else if (auto === 'highseas') game.start('highseas');
      else if (auto === 'oilfield') game.start('oilfield');
      else game.start(auto === 'survival' ? 'survival' : 'training');
    }
  })
  .catch(fatal);
