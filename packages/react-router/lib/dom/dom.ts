import { warning } from "../router/history";
import type { RelativeRoutingType } from "../router/router";
import type { FormEncType, HTMLFormMethod } from "../router/utils";
import { stripBasename } from "../router/utils";

export const defaultMethod: HTMLFormMethod = "get";
const defaultEncType: FormEncType = "application/x-www-form-urlencoded";

export function isHtmlElement(object: any): object is HTMLElement {
  return object != null && typeof object.tagName === "string";
}

export function isButtonElement(object: any): object is HTMLButtonElement {
  return isHtmlElement(object) && object.tagName.toLowerCase() === "button";
}

export function isFormElement(object: any): object is HTMLFormElement {
  return isHtmlElement(object) && object.tagName.toLowerCase() === "form";
}

export function isInputElement(object: any): object is HTMLInputElement {
  return isHtmlElement(object) && object.tagName.toLowerCase() === "input";
}

type LimitedMouseEvent = Pick<
  MouseEvent,
  "button" | "metaKey" | "altKey" | "ctrlKey" | "shiftKey"
>;

function isModifiedEvent(event: LimitedMouseEvent) {
  return !!(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey);
}

export function shouldProcessLinkClick(
  event: LimitedMouseEvent,
  target?: string
) {
  return (
    event.button === 0 && // Ignore everything but left clicks
    (!target || target === "_self") && // Let browser handle "target=_blank" etc.
    !isModifiedEvent(event) // Ignore clicks with modifier keys
  );
}

export type ParamKeyValuePair = [string, string];

export type URLSearchParamsInit =
  | string
  | ParamKeyValuePair[]
  | Record<string, undefined | string | string[]>
  | URLSearchParams;

/**
  Creates a URLSearchParams object using the given initializer.

  This is identical to `new URLSearchParams(init)` except it also
  supports arrays as values in the object form of the initializer
  instead of just strings. This is convenient when you need multiple
  values for a given key, but don't want to use an array initializer.

  For example, instead of:

  ```tsx
  let searchParams = new URLSearchParams([
    ['sort', 'name'],
    ['sort', 'price']
  ]);
  ```
  you can do:

  ```
  let searchParams = createSearchParams({
    sort: ['name', 'price']
  });
  ```

  @category Utils
 */
export function createSearchParams(
  init: URLSearchParamsInit = ""
): URLSearchParams {
  return new URLSearchParams(
    typeof init === "string" ||
    Array.isArray(init) ||
    init instanceof URLSearchParams
      ? init
      : Object.keys(init).reduce((memo, key) => {
          let value = init[key];
          return value === undefined ? memo : memo.concat(
            Array.isArray(value) ? value.map((v) => [key, v]) : [[key, value]]
          );
        }, [] as ParamKeyValuePair[])
  );
}

export function getSearchParamsForLocation(
  locationSearch: string,
  defaultSearchParams: URLSearchParams | null
) {
  let searchParams = createSearchParams(locationSearch);

  if (defaultSearchParams) {
    // Use `defaultSearchParams.forEach(...)` here instead of iterating of
    // `defaultSearchParams.keys()` to work-around a bug in Firefox related to
    // web extensions. Relevant Bugzilla tickets:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1414602
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1023984
    defaultSearchParams.forEach((_, key) => {
      if (!searchParams.has(key)) {
        defaultSearchParams.getAll(key).forEach((value) => {
          searchParams.append(key, value);
        });
      }
    });
  }

  return searchParams;
}

// Thanks https://github.com/sindresorhus/type-fest!
type JsonObject = { [Key in string]: JsonValue } & {
  [Key in string]?: JsonValue | undefined;
};
type JsonArray = JsonValue[] | readonly JsonValue[];
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type SubmitTarget =
  | HTMLFormElement
  | HTMLButtonElement
  | HTMLInputElement
  | FormData
  | URLSearchParams
  | JsonValue
  | null;

// One-time check for submitter support
let _formDataSupportsSubmitter: boolean | null = null;

function isFormDataSubmitterSupported() {
  if (_formDataSupportsSubmitter === null) {
    try {
      new FormData(
        document.createElement("form"),
        // @ts-expect-error if FormData supports the submitter parameter, this will throw
        0
      );
      _formDataSupportsSubmitter = false;
    } catch (e) {
      _formDataSupportsSubmitter = true;
    }
  }
  return _formDataSupportsSubmitter;
}

/**
 * Submit options shared by both navigations and fetchers
 */
interface SharedSubmitOptions {
  /**
   * The HTTP method used to submit the form. Overrides `<form method>`.
   * Defaults to "GET".
   */
  method?: HTMLFormMethod;

  /**
   * The action URL path used to submit the form. Overrides `<form action>`.
   * Defaults to the path of the current route.
   */
  action?: string;

  /**
   * The encoding used to submit the form. Overrides `<form encType>`.
   * Defaults to "application/x-www-form-urlencoded".
   */
  encType?: FormEncType;

  /**
   * Determines whether the form action is relative to the route hierarchy or
   * the pathname.  Use this if you want to opt out of navigating the route
   * hierarchy and want to instead route based on /-delimited URL segments
   */
  relative?: RelativeRoutingType;

  /**
   * In browser-based environments, prevent resetting scroll after this
   * navigation when using the <ScrollRestoration> component
   */
  preventScrollReset?: boolean;

  /**
   * Enable flushSync for this submission's state updates
   */
  flushSync?: boolean;
}

/**
 * Submit options available to fetchers
 */
export interface FetcherSubmitOptions extends SharedSubmitOptions {}

/**
 * Submit options available to navigations
 */
export interface SubmitOptions extends FetcherSubmitOptions {
  /**
   * Set `true` to replace the current entry in the browser's history stack
   * instead of creating a new one (i.e. stay on "the same page"). Defaults
   * to `false`.
   */
  replace?: boolean;

  /**
   * State object to add to the history stack entry for this navigation
   */
  state?: any;

  /**
   * Indicate a specific fetcherKey to use when using navigate=false
   */
  fetcherKey?: string;

  /**
   * navigate=false will use a fetcher instead of a navigation
   */
  navigate?: boolean;

  /**
   * Enable view transitions on this submission navigation
   */
  viewTransition?: boolean;
}

const supportedFormEncTypes: Set<FormEncType> = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

function getFormEncType(encType: string | null) {
  if (encType != null && !supportedFormEncTypes.has(encType as FormEncType)) {
    warning(
      false,
      `"${encType}" is not a valid \`encType\` for \`<Form>\`/\`<fetcher.Form>\` ` +
        `and will default to "${defaultEncType}"`
    );

    return null;
  }
  return encType;
}

export function getFormSubmissionInfo(
  target: SubmitTarget,
  basename: string
): {
  action: string | null;
  method: string;
  encType: string;
  formData: FormData | undefined;
  body: any;
} {
  let method: string;
  let action: string | null;
  let encType: string;
  let formData: FormData | undefined;
  let body: any;

  if (isFormElement(target)) {
    // When grabbing the action from the element, it will have had the basename
    // prefixed to ensure non-JS scenarios work, so strip it since we'll
    // re-prefix in the router
    let attr = target.getAttribute("action");
    action = attr ? stripBasename(attr, basename) : null;
    method = target.getAttribute("method") || defaultMethod;
    encType = getFormEncType(target.getAttribute("enctype")) || defaultEncType;

    formData = new FormData(target);
  } else if (
    isButtonElement(target) ||
    (isInputElement(target) &&
      (target.type === "submit" || target.type === "image"))
  ) {
    let form = target.form;

    if (form == null) {
      throw new Error(
        `Cannot submit a <button> or <input type="submit"> without a <form>`
      );
    }

    // <button>/<input type="submit"> may override attributes of <form>

    // When grabbing the action from the element, it will have had the basename
    // prefixed to ensure non-JS scenarios work, so strip it since we'll
    // re-prefix in the router
    let attr = target.getAttribute("formaction") || form.getAttribute("action");
    action = attr ? stripBasename(attr, basename) : null;

    method =
      target.getAttribute("formmethod") ||
      form.getAttribute("method") ||
      defaultMethod;
    encType =
      getFormEncType(target.getAttribute("formenctype")) ||
      getFormEncType(form.getAttribute("enctype")) ||
      defaultEncType;

    // Build a FormData object populated from a form and submitter
    formData = new FormData(form, target);

    // If this browser doesn't support the `FormData(el, submitter)` format,
    // then tack on the submitter value at the end.  This is a lightweight
    // solution that is not 100% spec compliant.  For complete support in older
    // browsers, consider using the `formdata-submitter-polyfill` package
    if (!isFormDataSubmitterSupported()) {
      let { name, type, value } = target;
      if (type === "image") {
        let prefix = name ? `${name}.` : "";
        formData.append(`${prefix}x`, "0");
        formData.append(`${prefix}y`, "0");
      } else if (name) {
        formData.append(name, value);
      }
    }
  } else if (isHtmlElement(target)) {
    throw new Error(
      `Cannot submit element that is not <form>, <button>, or ` +
        `<input type="submit|image">`
    );
  } else {
    method = defaultMethod;
    action = null;
    encType = defaultEncType;
    body = target;
  }

  // Send body for <Form encType="text/plain" so we encode it into text
  if (formData && encType === "text/plain") {
    body = formData;
    formData = undefined;
  }

  return { action, method: method.toLowerCase(), encType, formData, body };
}
