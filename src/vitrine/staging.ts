/**
 * Superfície de rascunho. O HTML de produto esconde banner e hostname.
 * Só um env explícito (1 | true | staging) revela — senão parece produção.
 */
export function isExplicitStaging(value: string | undefined): boolean {
  const text = value?.trim().toLowerCase() ?? '';
  return text === '1' || text === 'true' || text === 'staging';
}

/** Tira `hidden` dos blocos `.staging-only` quando o env de staging está ligado. */
export function applyStagingSurface(html: string, staging: boolean): string {
  if (!staging) return html;
  return html.replace(/class="([^"]*\bstaging-only\b[^"]*)" hidden/g, 'class="$1"');
}
