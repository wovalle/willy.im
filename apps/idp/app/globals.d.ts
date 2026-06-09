/**
 * `process.env` is available at runtime via the `nodejs_compat` flag. Wrangler's
 * generated types declare `NodeJS.ProcessEnv` (the binding shape) but not the
 * `process` global itself, so we declare it here without dragging all of
 * @types/node's globals into the Worker scope.
 */
declare const process: { env: NodeJS.ProcessEnv }
