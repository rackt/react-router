export function parse(fullpath: string) {
  const result: Record<string, boolean> = {};

  let segments = fullpath.split("/");
  segments.forEach((segment) => {
    const match = segment.match(/^:([\w-]+)(\?)?/);
    if (!match) return;
    const param = match[1];
    const isRequired = match[2] === undefined;

    result[param] ||= isRequired;
    return;
  });

  const hasSplat = segments.at(-1) === "*";
  if (hasSplat) result["*"] = true;
  return result;
}
