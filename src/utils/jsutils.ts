const MAX_ARRAY_LENGTH = 10;
const MAX_RECURSIVE_DEPTH = 2;

/**
 * Used to print values in error messages.
 */

const nodejsCustomInspectSymbol =
  typeof Symbol === "function" && typeof Symbol.for === "function"
    ? Symbol.for("nodejs.util.inspect.custom")
    : undefined;

export function inspect(value: any): string {
  return formatValue(value, []);
}

function formatValue(value: any, seenValues: any[]): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "function":
      return value.name ? `[function ${value.name}]` : "[function]";
    case "object":
      if (value === null) {
        return "null";
      }
      return formatObjectValue(value, seenValues);
    default:
      return String(value);
  }
}

function formatObjectValue(
  value: Object,
  previouslySeenValues: Array<any>
): string {
  if (previouslySeenValues.indexOf(value) !== -1) {
    return "[Circular]";
  }

  const seenValues = [...previouslySeenValues, value];
  const customInspectFn = getCustomFn(value);

  if (customInspectFn !== undefined) {
    const customValue = customInspectFn.call(value);

    // check for infinite recursion
    if (customValue !== value) {
      return typeof customValue === "string"
        ? customValue
        : formatValue(customValue, seenValues);
    }
  } else if (Array.isArray(value)) {
    return formatArray(value, seenValues);
  }

  return formatObject(value, seenValues);
}

function formatObject(object: Object, seenValues: Array<any>): string {
  const keys = Object.keys(object);
  if (keys.length === 0) {
    return "{}";
  }

  if (seenValues.length > MAX_RECURSIVE_DEPTH) {
    return "[" + getObjectTag(object) + "]";
  }

  const properties = keys.map((key) => {
    const value = formatValue(object[key], seenValues);
    return key + ": " + value;
  });

  return "{ " + properties.join(", ") + " }";
}

function formatArray(array: Array<any>, seenValues: Array<any>): string {
  if (array.length === 0) {
    return "[]";
  }

  if (seenValues.length > MAX_RECURSIVE_DEPTH) {
    return "[Array]";
  }

  const len = Math.min(MAX_ARRAY_LENGTH, array.length);
  const remaining = array.length - len;
  const items = [];

  for (let i = 0; i < len; ++i) {
    items.push(formatValue(array[i], seenValues));
  }

  if (remaining === 1) {
    items.push("... 1 more item");
  } else if (remaining > 1) {
    items.push(`... ${remaining} more items`);
  }

  return "[" + items.join(", ") + "]";
}

function getCustomFn(object: Object) {
  const customInspectFn = object[String(nodejsCustomInspectSymbol)];

  if (typeof customInspectFn === "function") {
    return customInspectFn;
  }
  // @ts-ignore
  if (typeof object?.inspect === "function") {
    // @ts-ignore
    return object?.inspect;
  }
}

function getObjectTag(object: Object): string {
  const tag = Object.prototype.toString
    .call(object)
    .replace(/^\[object /, "")
    .replace(/]$/, "");

  if (tag === "Object" && typeof object.constructor === "function") {
    const name = object.constructor.name;
    if (typeof name === "string" && name !== "") {
      return name;
    }
  }

  return tag;
}

export function isObjectLike(value: any): boolean {
  return typeof value == "object" && value !== null;
}

/**
 * Memoizes the provided three-argument function.
 */
export function memoize3<
  A1 = any | readonly any[],
  A2 = any | readonly any[],
  A3 = any | readonly any[],
  R = any
>(fn: (A1: A1, A2: A2, A3: A3) => R): (A1: A1, A2: A2, A3: A3) => R {
  let cache0;

  return function memoized(a1, a2, a3) {
    if (!cache0) {
      cache0 = new WeakMap();
    }
    let cache1 = cache0.get(a1);
    let cache2;
    if (cache1) {
      cache2 = cache1.get(a2);
      if (cache2) {
        const cachedValue = cache2.get(a3);
        if (cachedValue !== undefined) {
          return cachedValue;
        }
      }
    } else {
      cache1 = new WeakMap();
      cache0.set(a1, cache1);
    }
    if (!cache2) {
      cache2 = new WeakMap();
      cache1.set(a2, cache2);
    }
    const newValue = fn(a1, a2, a3);
    cache2.set(a3, newValue);
    return newValue;
  };
}

export function devAssert(condition: any, message: string): void {
  const booleanCondition = Boolean(condition);
  // istanbul ignore else (See transformation done in './resources/inlineInvariant.js')
  if (!booleanCondition) {
    throw new Error(message);
  }
}
