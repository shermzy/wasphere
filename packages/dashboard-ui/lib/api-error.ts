export function apiErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.trim()) return data
  if (!data || typeof data !== "object") return fallback

  const record = data as Record<string, unknown>
  if (Array.isArray(record.message)) {
    const message = record.message.filter((item): item is string => typeof item === "string").join("\n")
    if (message) return message
  }
  if (typeof record.message === "string" && record.message.trim()) return record.message
  if (typeof record.error === "string" && record.error.trim()) return record.error
  return fallback
}
