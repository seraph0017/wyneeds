function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    return Object.keys(input)
      .filter((key) => input[key] !== undefined)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = normalize(input[key]);
        return result;
      }, {});
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}
