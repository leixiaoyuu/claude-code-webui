export function parseBooleanQueryParam(
  value: string | null | undefined,
): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}
