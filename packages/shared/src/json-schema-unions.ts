/**
 * Obergrenze der Anthropic-API für Union-Parameter in einem `output_config`-Schema. Darüber antwortet
 * sie mit HTTP 400: „Schemas contains too many parameters with union types (… parameters with type
 * arrays or anyOf) … limit: 16" — gemessen am 29.09.2026 mit dem Rechnungs-Scan (18).
 */
export const API_UNION_PARAMETER_LIMIT = 16

/**
 * Zählt die Knoten mit `type`-Array oder `anyOf`, rekursiv über das ganze Schema — so, wie die API
 * zählt. Ein Stub der Messages-API validiert das Schema nicht; diese Zählung ist die Prüfung dafür.
 */
export function countUnionParameters(schema: unknown): number {
  if (Array.isArray(schema)) return schema.reduce((n: number, s) => n + countUnionParameters(s), 0)
  if (schema === null || typeof schema !== 'object') return 0
  const node = schema as Record<string, unknown>
  const self = Array.isArray(node.type) || 'anyOf' in node ? 1 : 0
  return Object.values(node).reduce((n: number, v) => n + countUnionParameters(v), self)
}
