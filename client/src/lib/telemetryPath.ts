/** Multiplayer invitations are private even when the surrounding address is recorded. */
export function redactRoomCode(value: string): string {
  return value.replace(/(\/play\/)[^/?#\s"'<>`),]+/gi, '$1:code');
}
