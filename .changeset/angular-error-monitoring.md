---
'@probara/angular': minor
---

New package: `@probara/angular`, error monitoring for Angular 19 and later on top of
`@probara/browser`, whose API it re-exports. `provideProbara({ dsn })` starts the browser SDK when
the app starts and installs `ProbaraErrorHandler`, which sends what Angular's `ErrorHandler` gets
as unhandled errors (the error behind an `HttpErrorResponse`, never a 400, 401 or 404) and still
logs it unless `logErrors: false`. Events are tagged with their route's path, failed navigations
are breadcrumbs, and `probaraHttpInterceptor` sends HttpClient failures of `httpErrors.targets` as
events, once.
