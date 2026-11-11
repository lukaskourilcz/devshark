import DevConsole from './DevConsole';
import DevAccess from './DevAccess';

export default function DevPage() {
  return <DevAccess>{lock => <DevConsole onLock={lock} />}</DevAccess>;
}
