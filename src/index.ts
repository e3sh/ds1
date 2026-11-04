import { GameEngine } from './core/GameEngine.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    console.error('Canvas element #game-canvas not found.');
    return;
  }

  const engine = new GameEngine(canvas);
  engine.start();

  console.log('DS1ish Web Engine Initialized.');
});
