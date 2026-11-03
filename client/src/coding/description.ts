/** Targets remain in authored prompts for server complexity guidance. The UI
 * presents them once, through Desired complexity, instead of repeating the
 * author's Target line in the description. Keep subsequent paragraphs. */
export function descriptionText(prompt: string): string {
  return prompt.replace(/(?:^|[\t ]+)Target:[^\n]*(?:\n|$)/gm, '\n').trim();
}
