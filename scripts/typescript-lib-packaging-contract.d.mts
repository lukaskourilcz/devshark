/** Check the config's additive trace ceiling and the checker's root references. */
export function assertTypeScriptLibPackaging(input: {
  root: string;
  isCheckerLibFile: (name: string) => boolean;
  rootLib: string;
}): void;
