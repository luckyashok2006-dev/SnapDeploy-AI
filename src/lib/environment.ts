/**
 * Environment detection and runtime mode guards for SnapDeploy AI.
 * Ensures production builds fail closed against mock/demo providers and test fixtures.
 */

let forceProductionOverride: boolean | null = null;

/**
 * For testing purposes only: allows targeted tests to simulate production or development environments.
 */
export function setProductionOverride(override: boolean | null): void {
  forceProductionOverride = override;
}

/**
 * Returns true if running in a real production build / environment.
 * Evaluates to false during Vitest / test execution and local development mode unless explicitly overridden.
 */
export function isProductionEnvironment(): boolean {
  if (forceProductionOverride !== null) {
    return forceProductionOverride;
  }

  // 1. Vitest or Node test environment
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
      return false;
    }
    if (process.env.NODE_ENV === 'production') {
      return true;
    }
  }

  // 2. Vite client environment
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    if (import.meta.env.MODE === 'test') {
      return false;
    }
    if (import.meta.env.PROD === true || import.meta.env.MODE === 'production') {
      return true;
    }
  }

  return false;
}
