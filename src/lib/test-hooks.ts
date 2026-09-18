export function shouldAttachTestHooks(env: {
  DEV?: boolean;
  MODE?: string;
  NODE_ENV?: string;
}): boolean {
  if (env.DEV === true) return true;
  if (env.MODE === 'test') return true;
  if (env.NODE_ENV && env.NODE_ENV !== 'production') return true;
  return false;
}
