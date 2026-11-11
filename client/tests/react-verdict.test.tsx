import { beforeAll, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingWorkbench } from '../src/coding/CodingWorkbench';
import { submitCoding } from '../src/coding/api';
import type { CodingVerdictResponse } from '../../shared/coding-api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({ Editor: () => <textarea aria-label="Test editor" /> }));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: () => ({data:undefined}), submitCoding: vi.fn(), revealCoding: vi.fn() }));
vi.mock('../src/coding/useReactHarness', () => {
  const run = {token:'local',status:'done',compileError:null,previewError:null,cases:[{name:'form submits',status:'fail',error:'local form event failed',durationMs:0}],logs:[],passed:0,failed:1,total:1,ran:true};
  const handle = {ready:true,run,start:async()=>run,reload:()=>{},iframeRef:()=>{},frameKey:0};
  return {HARNESS_URL:'/sandbox/index.html',useReactHarness:()=>handle};
});
const task: PlayableCodingTask = {
  id:'react-test',track:'react',level:1,tier:1,difficulty:'easy',focus:['forms'],
  title:'Test form',prompt:'Submit',
  starter:'export default function App(){return null}',hints:[],
  verify:'tests',estimatedMinutes:5,suite:'test("form submits",()=>{});',
};
function mount() {
  render(<MemoryRouter><LanguageProvider><CodingWorkbench task={task} initialCode={null} session="test-session" locked={null} signedIn mode="section" /></LanguageProvider></MemoryRouter>);
}
const result = (extra: Partial<CodingVerdictResponse>): CodingVerdictResponse => ({
  verdict:'passed',results:[{pass:true,actual:null,error:null}],hidden:null,check:null,logs:[],codeError:null,
  design:null,designReference:null,failureHint:null,puzzle:null,progress:null,firstPass:false,xpAwarded:0,xpForfeited:false,applied:false,github:null,solutions:null,...extra,
});
// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

it('keeps the workbench and server award after a pass', async () => {
  vi.mocked(submitCoding).mockResolvedValue(result({xpAwarded:25}));
  mount();
  fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:/^Passed/})).toHaveTextContent('Passed +25 XP'));
  expect(screen.queryByText('local form event failed')).toBeNull();
  expect(screen.getByLabelText('Test editor')).toBeVisible();
  expect(screen.getByRole('tab',{name:/Results/})).toHaveAttribute('aria-selected','true');
  const verdict = screen.getByRole('heading', { name: /^Passed/ }).closest('section')!;
  expect(within(verdict).getByRole('link', { name: 'Back to the list' })).toHaveAttribute('href', '/coding/react');
  expect(screen.queryByText(/Complexity/)).toBeNull();
});
it('shows only known complexity and the server award for an above-target pass', async () => {
  vi.mocked(submitCoding).mockResolvedValue(result({xpAwarded:15,complexity:{time:'O(n^2)',assessment:'above-target',explanation:'Nested scans',assumptions:'',guidance:{targetTime:'O(n)',targetSpace:null,note:''}}}));
  mount();
  fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:/^Passed/})).toHaveTextContent('Passed +15 XP'));
  expect(screen.getByText('Complexity: O(n^2)')).toBeVisible();
  expect(screen.getByRole('heading',{name:/^Passed/}).closest('section')).toHaveClass('cd-verdict--warning');
});
it('hides unknown complexity completely and displays the actual zero award', async () => {
  vi.mocked(submitCoding).mockResolvedValue(result({complexity:{time:null,assessment:'unknown',explanation:'Cannot determine',assumptions:'',guidance:{targetTime:null,targetSpace:null,note:''}}}));
  mount();
  expect(screen.queryByText(/Desired complexity/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:/^Passed/})).toHaveTextContent('Passed +0 XP'));
  expect(screen.queryByText(/Cannot determine|Complexity|Efficiency/)).toBeNull();
});
it('shows the server startup error so a learner can understand a failed submission', async () => {
  vi.mocked(submitCoding).mockResolvedValue(result({verdict:'error',results:[],codeError:'The React runner could not start. Try again in a moment.'}));
  mount();
  fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  await waitFor(()=>expect(screen.getByText(/The React runner could not start/)).toBeVisible());
  expect(screen.queryByText('local form event failed')).toBeNull();
});
