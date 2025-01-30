import type { Location } from "../../router/history";
import { parsePath } from "../../router/history";
import type { AgnosticDataRouteMatch } from "../../router/utils";

import type { AssetsManifest } from "./entry";
import type { RouteModules, RouteModule } from "./routeModules";
import type { EntryRoute } from "./routes";
import type { LoadRouteModuleFunction } from "./routeModules";
import type {
  HtmlLinkDescriptor,
  LinkDescriptor,
  PageLinkDescriptor,
} from "../../router/links";

/**
 * Gets all the links for a set of matches. The modules are assumed to have been
 * loaded already.
 */
export function getKeyedLinksForMatches(
  matches: AgnosticDataRouteMatch[],
  routeModules: RouteModules,
  manifest: AssetsManifest
): KeyedLinkDescriptor[] {
  let descriptors = matches
    .map((match): LinkDescriptor[][] => {
      let module = routeModules[match.route.id];
      let route = manifest.routes[match.route.id];
      return [
        route && route.css
          ? route.css.map((href) => ({ rel: "stylesheet", href }))
          : [],
        module?.links?.() || [],
      ];
    })
    .flat(2);

  let preloads = getModuleLinkHrefs(matches, manifest);
  return dedupeLinkDescriptors(descriptors, preloads);
}

function getRouteCssDescriptors(route: EntryRoute): HtmlLinkDescriptor[] {
  if (!route.css) return [];
  return route.css.map((href) => ({ rel: "stylesheet", href }));
}

export async function prefetchRouteCss(route: EntryRoute): Promise<void> {
  if (!route.css) return;
  let descriptors = getRouteCssDescriptors(route);
  await Promise.all(descriptors.map(prefetchStyleLink));
}

export async function prefetchStyleLinks(
  route: EntryRoute,
  routeModule: RouteModule
): Promise<void> {
  if ((!route.css && !routeModule.links) || !isPreloadSupported()) return;

  let descriptors: LinkDescriptor[] = [];
  if (route.css) {
    descriptors.push(...getRouteCssDescriptors(route));
  }
  if (routeModule.links) {
    descriptors.push(...routeModule.links());
  }
  if (descriptors.length === 0) return;

  let styleLinks: HtmlLinkDescriptor[] = [];
  for (let descriptor of descriptors) {
    if (!isPageLinkDescriptor(descriptor) && descriptor.rel === "stylesheet") {
      styleLinks.push({
        ...descriptor,
        rel: "preload",
        as: "style",
      } as HtmlLinkDescriptor);
    }
  }

  await Promise.all(styleLinks.map(prefetchStyleLink));
}

async function prefetchStyleLink(
  descriptor: HtmlLinkDescriptor
): Promise<void> {
  return new Promise((resolve) => {
    // don't prefetch non-matching media queries, or stylesheets that are
    // already in the DOM (active route revalidations)
    if (
      (descriptor.media && !window.matchMedia(descriptor.media).matches) ||
      document.querySelector(
        `link[rel="stylesheet"][href="${descriptor.href}"]`
      )
    ) {
      return resolve();
    }

    let link = document.createElement("link");
    Object.assign(link, descriptor);

    function removeLink() {
      // if a navigation interrupts this prefetch React will update the <head>
      // and remove the link we put in there manually, so we check if it's still
      // there before trying to remove it
      if (document.head.contains(link)) {
        document.head.removeChild(link);
      }
    }

    link.onload = () => {
      removeLink();
      resolve();
    };

    link.onerror = () => {
      removeLink();
      resolve();
    };

    document.head.appendChild(link);
  });
}

////////////////////////////////////////////////////////////////////////////////
export function isPageLinkDescriptor(
  object: any
): object is PageLinkDescriptor {
  return object != null && typeof object.page === "string";
}

function isHtmlLinkDescriptor(object: any): object is HtmlLinkDescriptor {
  if (object == null) {
    return false;
  }

  // <link> may not have an href if <link rel="preload"> is used with imageSrcSet + imageSizes
  // https://github.com/remix-run/remix/issues/184
  // https://html.spec.whatwg.org/commit-snapshots/cb4f5ff75de5f4cbd7013c4abad02f21c77d4d1c/#attr-link-imagesrcset
  if (object.href == null) {
    return (
      object.rel === "preload" &&
      typeof object.imageSrcSet === "string" &&
      typeof object.imageSizes === "string"
    );
  }

  return typeof object.rel === "string" && typeof object.href === "string";
}

export type KeyedHtmlLinkDescriptor = { key: string; link: HtmlLinkDescriptor };

export async function getKeyedPrefetchLinks(
  matches: AgnosticDataRouteMatch[],
  manifest: AssetsManifest,
  routeModules: RouteModules,
  loadRouteModule: LoadRouteModuleFunction
): Promise<KeyedHtmlLinkDescriptor[]> {
  let links = await Promise.all(
    matches.map(async (match) => {
      let route = manifest.routes[match.route.id];
      if (route) {
        let mod = await loadRouteModule(route, routeModules);
        return mod.links ? mod.links() : [];
      }
      return [];
    })
  );

  return dedupeLinkDescriptors(
    links
      .flat(1)
      .filter(isHtmlLinkDescriptor)
      .filter((link) => link.rel === "stylesheet" || link.rel === "preload")
      .map((link) =>
        link.rel === "stylesheet"
          ? ({ ...link, rel: "prefetch", as: "style" } as HtmlLinkDescriptor)
          : ({ ...link, rel: "prefetch" } as HtmlLinkDescriptor)
      )
  );
}

// This is ridiculously identical to transition.ts `filterMatchesToLoad`
export function getNewMatchesForLinks(
  page: string,
  nextMatches: AgnosticDataRouteMatch[],
  currentMatches: AgnosticDataRouteMatch[],
  manifest: AssetsManifest,
  location: Location,
  mode: "data" | "assets"
): AgnosticDataRouteMatch[] {
  let isNew = (match: AgnosticDataRouteMatch, index: number) => {
    if (!currentMatches[index]) return true;
    return match.route.id !== currentMatches[index].route.id;
  };

  let matchPathChanged = (match: AgnosticDataRouteMatch, index: number) => {
    return (
      // param change, /users/123 -> /users/456
      currentMatches[index].pathname !== match.pathname ||
      // splat param changed, which is not present in match.path
      // e.g. /files/images/avatar.jpg -> files/finances.xls
      (currentMatches[index].route.path?.endsWith("*") &&
        currentMatches[index].params["*"] !== match.params["*"])
    );
  };

  if (mode === "assets") {
    return nextMatches.filter(
      (match, index) => isNew(match, index) || matchPathChanged(match, index)
    );
  }

  // NOTE: keep this mostly up-to-date w/ the router data diff, but this
  // version doesn't care about submissions
  // TODO: this is really similar to stuff in router.ts, maybe somebody smarter
  // than me (or in less of a hurry) can share some of it. You're the best.
  if (mode === "data") {
    return nextMatches.filter((match, index) => {
      let manifestRoute = manifest.routes[match.route.id];
      if (!manifestRoute || !manifestRoute.hasLoader) {
        return false;
      }

      if (isNew(match, index) || matchPathChanged(match, index)) {
        return true;
      }

      if (match.route.shouldRevalidate) {
        let routeChoice = match.route.shouldRevalidate({
          currentUrl: new URL(
            location.pathname + location.search + location.hash,
            window.origin
          ),
          currentParams: currentMatches[0]?.params || {},
          nextUrl: new URL(page, window.origin),
          nextParams: match.params,
          defaultShouldRevalidate: true,
        });
        if (typeof routeChoice === "boolean") {
          return routeChoice;
        }
      }
      return true;
    });
  }

  return [];
}

export function getModuleLinkHrefs(
  matches: AgnosticDataRouteMatch[],
  manifest: AssetsManifest,
  { includeHydrateFallback }: { includeHydrateFallback?: boolean } = {}
): string[] {
  return dedupeHrefs(
    matches
      .map((match) => {
        let route = manifest.routes[match.route.id];
        if (!route) return [];
        let hrefs = [route.module];
        if (route.clientActionModule) {
          hrefs = hrefs.concat(route.clientActionModule);
        }
        if (route.clientLoaderModule) {
          hrefs = hrefs.concat(route.clientLoaderModule);
        }
        if (includeHydrateFallback && route.hydrateFallbackModule) {
          hrefs = hrefs.concat(route.hydrateFallbackModule);
        }
        if (route.imports) {
          hrefs = hrefs.concat(route.imports);
        }
        return hrefs;
      })
      .flat(1)
  );
}

function dedupeHrefs(hrefs: string[]): string[] {
  return [...new Set(hrefs)];
}

function sortKeys<Obj extends { [Key in keyof Obj]: Obj[Key] }>(obj: Obj): Obj {
  let sorted = {} as Obj;
  let keys = Object.keys(obj).sort();

  for (let key of keys) {
    sorted[key as keyof Obj] = obj[key as keyof Obj];
  }

  return sorted;
}

type KeyedLinkDescriptor<Descriptor extends LinkDescriptor = LinkDescriptor> = {
  key: string;
  link: Descriptor;
};

function dedupeLinkDescriptors<Descriptor extends LinkDescriptor>(
  descriptors: Descriptor[],
  preloads?: string[]
): KeyedLinkDescriptor<Descriptor>[] {
  let set = new Set();
  let preloadsSet = new Set(preloads);

  return descriptors.reduce((deduped, descriptor) => {
    let alreadyModulePreload =
      preloads &&
      !isPageLinkDescriptor(descriptor) &&
      descriptor.as === "script" &&
      descriptor.href &&
      preloadsSet.has(descriptor.href);

    if (alreadyModulePreload) {
      return deduped;
    }

    let key = JSON.stringify(sortKeys(descriptor));
    if (!set.has(key)) {
      set.add(key);
      deduped.push({ key, link: descriptor });
    }

    return deduped;
  }, [] as KeyedLinkDescriptor<Descriptor>[]);
}

// Detect if this browser supports <link rel="preload"> (or has it enabled).
// Originally added to handle the firefox `network.preload` config:
//   https://bugzilla.mozilla.org/show_bug.cgi?id=1847811
let _isPreloadSupported: boolean | undefined;
function isPreloadSupported(): boolean {
  if (_isPreloadSupported !== undefined) {
    return _isPreloadSupported;
  }
  let el: HTMLLinkElement | null = document.createElement("link");
  _isPreloadSupported = el.relList.supports("preload");
  el = null;
  return _isPreloadSupported;
}
