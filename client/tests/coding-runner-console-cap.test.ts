// F11-33: run the real evaluator; discarded console arguments must not
// change the learner's program through toJSON/getter side effects.
import { expect, it } from 'vitest';
import { evaluateCalls, LOG_OUTPUT_CUT, MAX_LOG_CHARS, MAX_LOG_LINE_CHARS, MAX_LOGS } from '../../shared/coding-evaluate';

const counterSource = (body: string) => `function probe(){let serializations=0,reads=0;const value={toJSON(){serializations++;return {get value(){reads++;return 'kept';}};}};${body};return [serializations,reads];}`;
const beforeCap = `console.log(value);console.dir(value);`;
const afterLines = `for(let i=0;i<${MAX_LOGS};i++)console.log(i);console.log(value);console.dir(value);console.log(value,value);`;
const fullLines = Math.floor(MAX_LOG_CHARS / MAX_LOG_LINE_CHARS);
const tailChars = MAX_LOG_CHARS % MAX_LOG_LINE_CHARS;
const fillOutput = `for(let i=0;i<${fullLines};i++)console.log('x'.repeat(${MAX_LOG_LINE_CHARS}));${tailChars ? `console.log('x'.repeat(${tailChars}));` : ''}`;
const afterCharacters = `${fillOutput}console.log(value);console.dir(value);console.log(value,value);`;
const fullLogs = Array.from({length:fullLines},()=> 'x'.repeat(MAX_LOG_LINE_CHARS));
if(tailChars) fullLogs.push('x'.repeat(tailChars));
const fixtures = [
  {name:'before the cap, ordinary arguments still serialize',body:beforeCap,counts:[2,2],logs:['{"value":"kept"}','{"value":"kept"}']},
  {name:'after the line cap, formatting invokes no toJSON or getter',body:afterLines,counts:[0,0],logs:Array.from({length:MAX_LOGS},(_,i)=>String(i))},
  {name:'after the character cut, only the first overflowing argument serializes',body:afterCharacters,counts:[1,1],logs:[...fullLogs,LOG_OUTPUT_CUT]},
] as const;

for(const fixture of fixtures) {
  it(fixture.name, async () => {
    const result=await evaluateCalls({code:counterSource(fixture.body),calls:['probe()'],expectations:[[...fixture.counts]]});
    expect(result.codeError).toBeNull();
    expect(result.timedOut).not.toBe(true);
    expect(result.results).toEqual([{pass:true,actual:JSON.stringify(fixture.counts),error:null}]);
    expect(result.logs).toEqual(fixture.logs);
  });
}
