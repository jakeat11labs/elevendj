/**
 * RAF - Request Animation Frame Manager
 * Singleton class that manages a single requestAnimationFrame loop
 * with subscription-based callbacks to prevent duplicate loops
 */

import { logger } from "../../logger";

type RAFCallback = (dt: number, timeElapsed: number) => void;

interface RAFFuncs {
  [key: string]: RAFCallback;
}

interface RAFLastPass {
  [key: string]: number;
}

interface RAFFramerates {
  [key: string]: number | null;
}

class RAF {
  private funcs: RAFFuncs = {};
  private lastPass: RAFLastPass = {};
  private framerates: RAFFramerates = {};
  public dt: number = 0;
  public timeElapsed: number = 0;
  public frame: number = 0;
  private dictionary: string[] = [];
  private last: number;
  public initTime: number;
  private isBlurred: boolean = false;
  private isRunning: boolean = false;

  constructor() {
    this.last = performance.now();
    this.initTime = performance.now();

    if (typeof window !== "undefined") {
      this.init();
    }
  }

  /**
   * Subscribe a callback to the RAF loop
   * @param id - Unique identifier for this subscription
   * @param func - Callback function to run each frame
   * @param framerate - Optional framerate limit (e.g., 30 for 30fps)
   */
  subscribe(id: string, func: RAFCallback, framerate: number | null = null): void {
    if (this.funcs[id]) {
      logger.warn(`RAF - A listener with id "${id}" already exists.`);
      return;
    }

    this.dictionary.push(id);
    this.funcs[id] = func;
    this.lastPass[id] = performance.now();

    if (framerate !== null) {
      this.framerates[id] = 1000 / framerate; // Convert to ms interval
    } else {
      this.framerates[id] = null;
    }
  }

  /**
   * Unsubscribe a callback from the RAF loop
   * @param id - Identifier of the subscription to remove
   */
  unsubscribe(id: string): void {
    if (this.funcs[id]) {
      const index = this.dictionary.indexOf(id);
      if (index > -1) {
        this.dictionary.splice(index, 1);
      }
      delete this.funcs[id];
      delete this.lastPass[id];
      delete this.framerates[id];
    }
  }

  /**
   * Check if a subscription exists
   * @param id - Identifier to check
   */
  has(id: string): boolean {
    return !!this.funcs[id];
  }

  /**
   * Initialize the RAF loop and event listeners
   */
  private init(): void {
    if (this.isRunning) return;

    window.addEventListener("focus", () => {
      this.last = performance.now();
    });

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.isBlurred = false;
        this.last = performance.now(); // Reset last to prevent huge dt spike
      } else {
        this.isBlurred = true;
      }
    });

    this.isRunning = true;
    this.update = this.update.bind(this);
    this.update();
  }

  /**
   * Main update loop
   */
  private update(): void {
    requestAnimationFrame(this.update);

    if (this.isBlurred) return;

    const now = performance.now();
    this.dt = now - this.last;
    this.timeElapsed += this.dt;
    this.frame++;

    // Execute all subscribed functions
    for (let i = 0; i < this.dictionary.length; i++) {
      const id = this.dictionary[i];
      const framerate = this.framerates[id];

      // Check framerate limit
      if (framerate !== null && now - this.lastPass[id] < framerate) {
        continue;
      }

      if (typeof this.funcs[id] === "function") {
        this.lastPass[id] = now;
        this.funcs[id](this.dt, this.timeElapsed);
      }
    }

    this.last = now;
  }

  /**
   * Get delta time in seconds
   */
  getDeltaSeconds(): number {
    return this.dt / 1000;
  }
}

// Export singleton instance
const instance = new RAF();
export default instance;
