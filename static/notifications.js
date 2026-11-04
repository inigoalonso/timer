'use strict';
class MilestoneNotifications {
  constructor(deliver) {
    this.deliver = deliver;
    this.enabled = false;
    this.previous = null;
    this.fired = new Set();
  }

  update(state, remaining, synchronized) {
    if (state.mode === 'prepared') {
      this.previous = null;
      this.fired.clear();
      return;
    }
    if (!this.enabled || !synchronized) {
      this.previous = null;
      return;
    }
    if (state.mode !== 'running') {
      this.previous = remaining;
      return;
    }
    const crossed = [300000, 60000, 0].filter(threshold =>
      this.previous !== null && this.previous > threshold && remaining <= threshold && !this.fired.has(threshold));
    this.previous = remaining;
    for (const threshold of crossed) this.fired.add(threshold);
    if (crossed.length) {
      const threshold = crossed[crossed.length - 1];
      this.deliver(threshold === 0 ? 'Time is up' : threshold === 60000 ? '1 minute left' : '5 minutes left', state);
    }
  }
}