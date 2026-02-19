/**
 * CameraEngine.test.ts
 *
 * CameraEngine のユニットテスト。
 * DOM / R3F に依存しない純粋なロジックテスト。
 */
import { describe, it, expect } from 'vitest';
import { CameraEngine } from '../scene/engine/CameraEngine.js';
import type { CameraState } from '@static3d/types';

const START: CameraState = {
  position: [0, 5, 10],
  target: [0, 0, 0],
  fov: 60,
};

const END: CameraState = {
  position: [10, 0, 0],
  target: [5, 0, 0],
  fov: 45,
};

describe('CameraEngine', () => {
  it('initialises with the given CameraState', () => {
    const engine = new CameraEngine(START);
    const state = engine.getState();
    expect(state.position).toEqual([0, 5, 10]);
    expect(state.target).toEqual([0, 0, 0]);
    expect(state.fov).toBe(60);
    expect(state.isTransitioning).toBe(false);
  });

  it('set() changes state immediately without animation', () => {
    const engine = new CameraEngine(START);
    engine.set(END);
    const state = engine.getState();
    expect(state.position).toEqual([10, 0, 0]);
    expect(state.isTransitioning).toBe(false);
  });

  it('transitionTo() starts a transition', () => {
    const engine = new CameraEngine(START);
    engine.transitionTo(END, { duration: 1.0 });
    const state = engine.getState();
    expect(state.isTransitioning).toBe(true);
  });

  it('tick() advances the transition by delta', () => {
    const engine = new CameraEngine(START);
    engine.transitionTo(END, { duration: 1.0, easing: 'linear' });

    // 0.5 秒後 → t = 0.5
    engine.tick(0.5);
    const mid = engine.getState();

    expect(mid.position[0]).toBeCloseTo(5, 1); // lerp(0, 10, 0.5)
    expect(mid.isTransitioning).toBe(true);
  });

  it('tick() completes transition when progress >= 1', () => {
    const engine = new CameraEngine(START);
    engine.transitionTo(END, { duration: 1.0, easing: 'linear' });

    engine.tick(1.0); // exactly 1 second
    const final = engine.getState();

    expect(final.position).toEqual([10, 0, 0]);
    expect(final.target).toEqual([5, 0, 0]);
    expect(final.fov).toBeCloseTo(45);
    expect(final.isTransitioning).toBe(false);
  });

  it('tick() beyond 1.0 clamps to final state', () => {
    const engine = new CameraEngine(START);
    engine.transitionTo(END, { duration: 1.0, easing: 'linear' });

    engine.tick(2.0); // overshoot
    const state = engine.getState();
    expect(state.position).toEqual([10, 0, 0]);
    expect(state.isTransitioning).toBe(false);
  });

  it('supports all easing names without throwing', () => {
    const easings: Array<NonNullable<import('@static3d/types').TransitionConfig['easing']>> = [
      'linear',
      'easeInCubic',
      'easeOutCubic',
      'easeInOutCubic',
      'easeInQuart',
      'easeOutQuart',
      'easeInOutQuart',
    ];

    for (const easing of easings) {
      const engine = new CameraEngine(START);
      engine.transitionTo(END, { duration: 1.0, easing });
      expect(() => engine.tick(0.5)).not.toThrow();
    }
  });
});
