/** Check actual deployment selection and the configured checker root's references. */
export function assertTypeScriptLibPackaging(input: {
  root: string;
  isCheckerLibFile: (name: string) => boolean;
  rootLib: string;
}): void;
