export const CRM_STAGES = ["Lead", "Qualified", "Customer", "Inactive"] as const

export type CrmStage = (typeof CRM_STAGES)[number]

const CRM_PREFIX = "crm:"
const CRM_TAGS = new Set(CRM_STAGES.map((stage) => `${CRM_PREFIX}${stage}`))

export function crmTag(stage: CrmStage): string {
  return `${CRM_PREFIX}${stage}`
}

/** Return a stage only when the tags contain exactly one recognized CRM tag. */
export function parseCrmStage(tags: readonly string[]): CrmStage | null {
  const matches = tags.filter((tag) => CRM_TAGS.has(tag))
  if (matches.length !== 1) return null
  return matches[0].slice(CRM_PREFIX.length) as CrmStage
}

/** Replace reserved CRM tags and preserve ordinary tags without duplicates. */
export function replaceCrmStage(tags: readonly string[], stage: CrmStage): string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const rawTag of tags) {
    const tag = rawTag.trim()
    if (!tag || tag.startsWith(CRM_PREFIX)) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(tag)
  }
  next.push(crmTag(stage))
  return next
}

export function nonCrmTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => !tag.startsWith(CRM_PREFIX))
}
