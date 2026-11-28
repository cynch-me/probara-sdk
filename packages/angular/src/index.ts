/**
 * `@probara/angular`: Probara error monitoring for Angular, on top of `@probara/browser`, whose
 * whole API it re-exports. `provideProbara({ dsn })` in the app's providers.
 */
export * from '@probara/browser';
export { ProbaraErrorHandler } from './error-handler.js';
export type { ProbaraErrorHandlerOptions } from './error-handler.js';
export { probaraHttpInterceptor } from './http.js';
export type { AngularHttpErrors } from './http.js';
export { SDK_NAME, provideProbara } from './provide.js';
export { VERSION } from './version.js';
export type { ProbaraAngularOptions } from './provide.js';
