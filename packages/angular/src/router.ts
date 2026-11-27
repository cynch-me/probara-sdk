/**
 * The router's part: each event carries the path of the route it happened on
 * (`/projects/:projectId`), and failed navigations are breadcrumbs. Successful navigations are
 * breadcrumbs already: the browser SDK records the page's history changes.
 */
import { DestroyRef } from '@angular/core';
import {
  NavigationEnd,
  NavigationError,
  type ActivatedRouteSnapshot,
  type Router,
} from '@angular/router';
import { addBreadcrumb, setTag } from '@probara/browser';

/** The path of the route `root` leads to, its parameters as `:name`. */
export function routePath(root: ActivatedRouteSnapshot): string {
  const parts: string[] = [];
  let node: ActivatedRouteSnapshot | null = root;
  while (node !== null) {
    const path = node.routeConfig?.path;
    if (path !== undefined && path !== '') parts.push(path);
    node = node.firstChild;
  }
  return `/${parts.join('/')}`;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

export function watchRouter(router: Router, destroyRef: DestroyRef): void {
  const subscription = router.events.subscribe((event) => {
    try {
      if (event instanceof NavigationEnd) {
        setTag('route', routePath(router.routerState.snapshot.root));
      } else if (event instanceof NavigationError) {
        addBreadcrumb({
          type: 'navigation',
          category: 'angular.router',
          level: 'error',
          message: `Navigation to ${event.url} failed: ${messageOf(event.error)}`,
        });
      }
    } catch {
      // Reporting never breaks navigation.
    }
  });
  destroyRef.onDestroy(() => {
    subscription.unsubscribe();
  });
}
