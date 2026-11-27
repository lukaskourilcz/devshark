/** M01 — Customer discovery.
 *
 * The first module of the FDE path, and the one every later module quotes
 * back: who does the work today, what it costs them, and what this project
 * has agreed not to do. Two lessons, one four-question check, and two written
 * pieces: the one-page scope (workflow, questions, baseline, success metric,
 * scope, sequencing, non-goals, risks, acceptance) and a capped executive
 * update (audience, decisions, open questions, next step).
 *
 * Nothing here is machine-gradable beyond the check. Both written pieces are
 * artifacts: the server confirms every required field is present and inside
 * its length cap, records the submission as self-reviewed, and says plainly
 * that a character count cannot judge a baseline or an update. The module
 * requires both, so guided completion waits for them.
 *
 * The practitioner sources (Qureshi, The Pragmatic Engineer, PostHog, and
 * the Vercel posting) were read in October 2026 and are cited
 * for what they say, never as a hiring standard.
 *
 * Marlbrook Systems, its ticket volumes, its shadowing clock and its
 * transcript are fixtures written for this module. No customer data, no live
 * system, no vendor account. */

import type { ModuleSource } from '../../types';

export const FDE_M01: ModuleSource = {
  id: 'fde-v1-m01',
  title: 'Customer discovery',
  outcomes: [
    'Find the operator whose hands are on the work, watch one real item end to end, and name everyone who can refuse the project.',
    'Separate the mechanism a customer asked for from the job they are trying to do, and say which requirements are solutions in disguise.',
    'Write a baseline as a number with a population, a window and a method someone else can repeat, and a success condition with a date beside it.',
    'Write the exclusions down as non-goals, because an exclusion nobody wrote down is not one.',
    'Order the work so the smallest slice that runs end to end reaches an operator first, and name what each later step waits on.',
    'Write an executive update a sponsor can act on in two minutes: who it is for, the decisions you need, the open questions and the next step.',
  ],
  competencies: ['discovery'],
  dependsOn: [],
  estimatedMinutes: 180,
  lessons: [
    {
      id: 'fde-v1-m01-l1',
      title: 'The workflow and who is in it',
      summary:
        'Find the operator, watch the work as it happens today, separate the stated request from the job to be done, and name the people who can veto the result.',
      estimatedMinutes: 25,
      sources: [
        {
          label: 'NIST AI Risk Management Framework',
          url: 'https://www.nist.gov/itl/ai-risk-management-framework',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'OWASP Top 10 for Large Language Model Applications',
          url: 'https://owasp.org/www-project-top-10-for-large-language-model-applications/',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'Nabeel S. Qureshi, “Reflections on Palantir” (October 2024)',
          url: 'https://nabeelqu.co/reflections-on-palantir',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'The Pragmatic Engineer, “What are Forward Deployed Engineers, and why are they so in demand?” (August 2025)',
          url: 'https://newsletter.pragmaticengineer.com/p/forward-deployed-engineers',
          reviewedOn: '2026-10-21',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'The request usually arrives as a solution. “Add AI to support” names a technology and a department, and it tells you nothing about what anyone is currently unable to do. Your first week is spent turning that sentence back into the problem it came from.',
        },
        {
          kind: 'prose',
          body:
            'Start by finding the operator: the person whose hands are on the work every day. They are rarely the person who wrote you the email. The sponsor pays for the project and can cancel it; the operator decides whether the result gets used, by using it or quietly not using it. NIST’s AI Risk Management Framework puts this under its Map function — establish the context and the people affected before you build, not after.',
        },
        {
          kind: 'table',
          caption: 'Four positions around one project, and what it costs you to leave each one out of discovery.',
          headers: ['Role', 'What they control', 'What their absence costs you'],
          rows: [
            ['Sponsor', 'The budget, and whether the project continues at all', 'You build something nobody has agreed to pay to run'],
            ['Operator', 'Whether the result is used, every day, in practice', 'You speed up a step that was never the expensive one'],
            ['Gatekeeper', 'Permission for the system to touch data, money or customers', 'A refusal arrives after the build, when changing course is most expensive'],
            ['Recipient', 'Their response to the output, including feedback, complaints and any applicable choices', 'A change that helps the desk and makes the customer’s day worse'],
          ],
        },
        {
          kind: 'prose',
          body:
            'Then watch the work. Interviews and observation offer different evidence; compare what people describe with what you can observe. Ask to sit with one agent while they handle three real items, keep a clock running, and write down every system they open. Agree on consent, data access and interruption rules before observing; avoid disrupting active work.',
        },
        {
          kind: 'prose',
          body:
            'Engineers who have done this job describe the same first move. Nabeel Qureshi, a forward deployed engineer at Palantir from 2015, writes that going onsite captures the tacit knowledge of how a customer works, which the flattened list of requirements behind most enterprise software leaves out. Gergely Orosz’s account of OpenAI’s forward deployed engineers in The Pragmatic Engineer starts their early scoping phase onsite: sit with users, map out their processes, identify the biggest value areas, prototype with synthetic data. Read both as practitioner accounts of a habit, with no measured outcome attached. You spend the first week watching the work, and the build waits.',
        },
        {
          kind: 'trace',
          caption: 'One ticket at Marlbrook Systems, start to finish, with the clock running. Step through it before reading what it showed.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['Read ticket', 'Find account', 'Check plan', 'Reproduce', 'Search KB', 'Draft reply', 'Send'],
                note: 'The ticket arrives at 09:12. It is the seven steps below, in order, and nothing has been touched yet.',
                counter: { label: 'Minutes elapsed', value: 0 },
              },
              {
                cells: ['Read ticket', 'Find account', 'Check plan', 'Reproduce', 'Search KB', 'Draft reply', 'Send'],
                marks: [{ index: 0, role: 'active' }],
                note: 'The agent reads the ticket. It says the export is broken. There is no account number, no error text and no timestamp.',
                counter: { label: 'Minutes elapsed', value: 1 },
              },
              {
                cells: ['Read ticket', 'Find account', 'Check plan', 'Reproduce', 'Search KB', 'Draft reply', 'Send'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'active' },
                ],
                note: 'The agent searches the CRM by the sender’s email domain. Three accounts share it. She picks the one with an open contract and hopes.',
                counter: { label: 'Minutes elapsed', value: 6 },
              },
              {
                cells: ['Read ticket', 'Find account', 'Check plan', 'Reproduce', 'Search KB', 'Draft reply', 'Send'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'active' },
                ],
                note: 'Entitlement lives in a second system with its own login. She opens it and confirms the account’s plan includes scheduled exports.',
                counter: { label: 'Minutes elapsed', value: 11 },
              },
              {
                cells: ['Read ticket', 'Find account', 'Check plan', 'Reproduce', 'Search KB', 'Draft reply', 'Send'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'active' },
                ],
                note: 'She reproduces the same symptom on an authorized staging tenant. That supports investigation of a shared issue but does not establish its cause or rule out a customer-specific problem.',
                counter: { label: 'Minutes elapsed', value: 15 },
              },
              {
                cells: ['Read ticket', 'Find account', 'Check plan', 'Reproduce', 'Search KB', 'Draft reply', 'Send'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'settled' },
                  { index: 4, role: 'active' },
                ],
                note: 'A knowledge-base search for “scheduled export” returns the answer as the second hit. She has seen this article before.',
                counter: { label: 'Minutes elapsed', value: 16 },
              },
              {
                cells: ['Read ticket', 'Find account', 'Check plan', 'Reproduce', 'Search KB', 'Draft reply', 'Send'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'settled' },
                  { index: 4, role: 'settled' },
                  { index: 5, role: 'active' },
                ],
                note: 'She drafts the reply from the article. One paragraph, most of it pasted, two sentences of her own.',
                counter: { label: 'Minutes elapsed', value: 18 },
              },
              {
                cells: ['Read ticket', 'Find account', 'Check plan', 'Reproduce', 'Search KB', 'Draft reply', 'Send'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'settled' },
                  { index: 4, role: 'settled' },
                  { index: 5, role: 'settled' },
                  { index: 6, role: 'active' },
                ],
                note: 'The reply goes out at 09:31. Nineteen minutes, of which ten went to working out which customer this was and what they had paid for.',
                counter: { label: 'Minutes elapsed', value: 19 },
              },
            ],
          },
        },
        {
          kind: 'prose',
          body:
            'The sponsor’s theory was that agents retype the same answers. Drafting took two minutes. Ten of the nineteen went to identity: which account, and what does their plan include. The knowledge-base search that the sponsor wanted replaced took one minute and worked.\n\nThat changes what you propose. A deterministic CRM-to-entitlement lookup is a candidate worth testing against the same clock. This one observation does not prove its savings or cost. Resolve ambiguous account matches and enforce authorization; an email domain alone does not establish account ownership.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'The clock above is a fixture written for this module, not a recording of a real support desk. Real observations can vary across tickets and operators. Write down the messy version, including how many items you actually watched, because the number of observations is part of the claim.',
        },
        {
          kind: 'prose',
          body:
            'The second thing discovery separates is the mechanism from the job. A stated request names a thing to build. The job is what the person is trying to accomplish, under conditions they may not have mentioned. You get from one to the other by asking what they would be able to do afterwards that they cannot do now, and refusing to accept a restatement of the mechanism as the answer.',
        },
        {
          kind: 'code',
          language: 'text',
          code: `Sponsor: "We want the AI to write the answers. The agents keep typing
          the same things over and over."

You:     "Take me through the last one you saw."

Sponsor: "A customer asked why their export stopped. We had answered that
          two weeks earlier for somebody else."

You:     "Who found the earlier answer?"

Agent:   "I did. That part is quick, it is in the knowledge base. What
          takes the time is working out which account is asking and
          whether their plan even includes scheduled exports."`,
          caption: 'A fixture transcript. The sponsor describes a mechanism; the agent, asked one level down, describes the job.',
        },
        {
          kind: 'prose',
          body:
            'A requirement can specify a mechanism for a legitimate reason, but ask which underlying need it serves. “Summarise the thread” might mean “see the relevant account history without opening three tabs.” A summary and a well-placed link are candidates to compare; neither is automatically cheaper or sufficient. Preserve explicit contractual or policy constraints.',
        },
        {
          kind: 'table',
          caption: 'Three stated requirements from the Marlbrook discovery week, the question that opened each one, and what came back.',
          headers: ['What they asked for', 'The question that unpacks it', 'What turned out to be needed'],
          rows: [
            [
              '“Summarise the ticket thread”',
              '“What would you be able to do that you cannot do now?”',
              'See the account history without opening three tabs',
            ],
            [
              '“It should learn from our past replies”',
              '“Which past reply would you have wanted last Tuesday?”',
              'Search the knowledge base by symptom instead of by product name',
            ],
            [
              '“Make it fast”',
              '“Fast enough for what, and measured from when to when?”',
              'A suggestion on screen before the agent has finished reading the ticket',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'The last discovery job is finding the people who can say no. At Marlbrook that list is the support lead, whose team has to adopt the thing; the security reviewer, who has to approve a system reading customer ticket content; the data owner for the CRM; and the finance controller, if anything the assistant proposes ever moves money. None of them attended the kickoff. Ask one question in week one: who has to say yes before this touches a customer, and write the names down.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'An omitted approval owner can cause expensive late changes or prevent release. The security reviewer will ask what happens when a knowledge-base article or a customer message contains an instruction aimed at the assistant. Read the OWASP list for LLM applications before that meeting so you arrive with the answer rather than a promise to look into it.',
        },
        {
          kind: 'prose',
          body:
            'What leaves the discovery week is three things: the workflow as you watched it, the list of people in it with what each one controls, and the questions you could not answer. The third list is not a failure. Written down, it is the agenda for the next conversation; left out, it becomes an assumption nobody remembers making.',
        },
      ],
    },
    {
      id: 'fde-v1-m01-l2',
      title: 'Baseline and scope',
      summary:
        'Measure what the work costs today before proposing anything, write the success metric as a number with a date, write the non-goals down, sequence the work, and report it upward in a few lines.',
      estimatedMinutes: 35,
      sources: [
        {
          label: 'Google SRE Book — Service Level Objectives',
          url: 'https://sre.google/sre-book/service-level-objectives/',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'NIST AI Risk Management Framework',
          url: 'https://www.nist.gov/itl/ai-risk-management-framework',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'PostHog, “WTF is a forward deployed engineer? (and why everyone is hiring them)” (February 2026)',
          url: 'https://posthog.com/blog/forward-deployed-engineer',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'The Pragmatic Engineer, “What are Forward Deployed Engineers, and why are they so in demand?” (August 2025)',
          url: 'https://newsletter.pragmaticengineer.com/p/forward-deployed-engineers',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Vercel, Forward-Deployed Engineer job posting',
          url: 'https://vercel.com/careers/forward-deployed-engineer-5752684004',
          reviewedOn: '2026-10-21',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'Forward deployed engineers spend more of their time scoping than most engineers do. Jina Yoon’s PostHog explainer says forward deployed engineers spend far more of their time than other engineers talking to customers and scoping projects “to decide what to build, and how”. This lesson turns that time into one page you can hand to someone else.',
        },
        {
          kind: 'prose',
          body:
            'You cannot claim an improvement without a number from before. Record the pre-change measurement and its limitations before presenting a prototype as an improvement.',
        },
        {
          kind: 'prose',
          body:
            'A usable baseline carries four parts: a quantity, the population it covers, the window it was taken over, and a method someone else can repeat. Drop the population and you cannot tell whether the number moved or the mix of tickets changed. Drop the method and the person who re-measures after launch will measure something else and report a win.\n\nThe SRE book’s chapter on service level objectives makes the same split for running systems: the indicator is what you measure, the objective is the value you are aiming at, and they are two different sentences. A discovery baseline applies the metric to a defined pre-change window; it may require many observations, and comparison must account for changes in traffic or measurement.',
        },
        {
          kind: 'table',
          caption: 'Four proposed baseline statements and the evidence each still needs.',
          headers: ['Proposed baseline', 'Can someone else reproduce it?', 'What to write instead'],
          rows: [
            [
              'Support is slow',
              'No. No quantity, no population, no window.',
              'Median minutes from ticket creation to first agent reply, tier-1 export tickets, August, from the ticket export',
            ],
            [
              'Agents spend most of their day on repeat questions',
              'No. “Most” is a feeling, and nobody has agreed what counts as a repeat.',
              'Share of August tickets whose resolution cites a knowledge-base article, counted from the same export',
            ],
            [
              'We handle about 400 tickets a month',
              'A rough workload estimate, not yet a reproducible measurement of the target step.',
              'Keep it as context, and measure the cost of the specific step you intend to move',
            ],
            [
              'Handle time will drop by 40 percent',
              'That is the target. There is nothing yet for it to be 40 percent of.',
              'Write the starting number first, then put the target beside it with a date',
            ],
          ],
        },
        {
          kind: 'code',
          language: 'json',
          code: `{
  "metric": "minutes_from_ticket_created_to_first_agent_reply",
  "population": "tier-1 tickets tagged 'export', auto-closed duplicates removed",
  "window": "2026-08-01 to 2026-08-31",
  "observations": 412,
  "median": 19,
  "p90": 47,
  "method": "ticket system CSV export, created_at to first_public_comment_at",
  "repeatable_by": "support lead, saved August snapshot and query; later windows are new observations",
  "taken_on": "2026-09-04"
}`,
          caption: 'A hypothetical baseline record, not measured customer data. A reproducible implementation must also retain its source snapshot, timezone, inclusion/exclusion rules and quantile method.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Write the method down at the moment you take the measurement, not afterwards. The person who repeats it in four months will be someone else, possibly the support lead you handed the project to, and “the same way we did it before” is not a method. NIST’s Measure function asks the same of AI systems: the measurement has to be documented well enough that a different person gets the same answer.',
        },
        {
          kind: 'prose',
          body:
            'The success condition is the baseline’s partner: a number, measured the same way, with a date. “Faster triage” is a mood. “Median time to first reply on tier-1 export tickets falls from 19 minutes to 12, measured with the same documented export procedure on a comparable later window, by 31 March 2027” is a sentence you can be wrong about, which is what makes it worth writing. Agree it with the sponsor and the operator together, because they will otherwise be measuring different things.',
        },
        {
          kind: 'prose',
          body:
            'Write that sentence as the success metric, and keep the acceptance condition on its own line. The success metric is the outcome you measure after launch: the 19-to-12-minute median, its date, and one guardrail you report beside it, such as the share of suggested replies an agent had to rewrite. The acceptance condition is the gate before launch: what a trial on agreed tickets has to show, and who signs it. Merge the two and the sponsor ends up signing off a pilot against a number nobody can measure until March.',
        },
        {
          kind: 'prose',
          body:
            'Say which slice the number covers, and what you will report next to it. One median can improve while a whole ticket type gets worse, and an aggregate across all tickets can conceal that change. Quality also has to be reported separately from cost and from how long the thing takes: a change that halves handle time and doubles corrections needs assessment against the agreed quality and cost criteria, and a single blended figure will not tell you which happened.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'The scope brief and the executive update at the end of this module are recorded as self-reviewed. The server checks that every required field is filled in and inside its length cap, and that is all a character count can establish. It cannot tell whether your baseline can be re-measured, whether your five questions would change anything, whether your non-goals are the ones that needed writing down, or whether an executive could decide from your update. Those you judge yourself, against the rubric.',
        },
        {
          kind: 'prose',
          body:
            'Non-goals are the cheapest thing in a scope document and the one people skip. An exclusion nobody wrote down is not an exclusion: it is a thing the customer still expects, and you will find out in week six when they ask where it is. Writing it down costs a line and buys you a sentence to point at.',
        },
        {
          kind: 'trace',
          caption: 'Six candidates from the Marlbrook discovery week, sorted into scope and non-goals one at a time.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['Suggest reply', 'Resolve account', 'Auto-send', 'Rewrite KB', 'Route to tier', 'Refunds'],
                note: 'Six things came out of the discovery week. None is decided, and all six are in the sponsor’s head as “the project”.',
                counter: { label: 'Still undecided', value: 6 },
              },
              {
                cells: ['Suggest reply', 'Resolve account', 'Auto-send', 'Rewrite KB', 'Route to tier', 'Refunds'],
                marks: [{ index: 1, role: 'settled' }],
                note: 'Resolving the account from the sender address goes in scope. The single observed ticket spent ten minutes on account and plan checks. Test a deterministic lookup, including ambiguous matches and authorization; this is not a per-ticket savings forecast.',
                counter: { label: 'Still undecided', value: 5 },
              },
              {
                cells: ['Suggest reply', 'Resolve account', 'Auto-send', 'Rewrite KB', 'Route to tier', 'Refunds'],
                marks: [
                  { index: 1, role: 'settled' },
                  { index: 4, role: 'settled' },
                ],
                note: 'Routing to the right tier goes in scope. The rules are already written on the support lead’s whiteboard, so this is deterministic code with a test per rule.',
                counter: { label: 'Still undecided', value: 4 },
              },
              {
                cells: ['Suggest reply', 'Resolve account', 'Auto-send', 'Rewrite KB', 'Route to tier', 'Refunds'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 4, role: 'settled' },
                ],
                note: 'Drafting a suggested reply from a knowledge-base article goes in scope, with an agent pressing send. A model-assisted draft is one candidate here; evaluate it against the agreed quality and cost criteria.',
                counter: { label: 'Still undecided', value: 3 },
              },
              {
                cells: ['Suggest reply', 'Resolve account', 'Auto-send', 'Rewrite KB', 'Route to tier', 'Refunds'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'excluded' },
                  { index: 4, role: 'settled' },
                ],
                note: 'Sending without an agent is a non-goal for this phase. The support lead will not accept it, and nobody has agreed who answers for a wrong reply.',
                counter: { label: 'Still undecided', value: 2 },
              },
              {
                cells: ['Suggest reply', 'Resolve account', 'Auto-send', 'Rewrite KB', 'Route to tier', 'Refunds'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'excluded' },
                  { index: 3, role: 'excluded' },
                  { index: 4, role: 'settled' },
                ],
                note: 'Rewriting the knowledge base is a non-goal. It is real work with its own owner and its own schedule, and folding it in here would move the date without anyone deciding to.',
                counter: { label: 'Still undecided', value: 1 },
              },
              {
                cells: ['Suggest reply', 'Resolve account', 'Auto-send', 'Rewrite KB', 'Route to tier', 'Refunds'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'excluded' },
                  { index: 3, role: 'excluded' },
                  { index: 4, role: 'settled' },
                  { index: 5, role: 'excluded' },
                ],
                note: 'Refunds are a non-goal. Money moves, the finance controller has not been in a single meeting, and no approval path exists. Three in scope, three written down as out.',
                counter: { label: 'Still undecided', value: 0 },
              },
            ],
          },
        },
        {
          kind: 'prose',
          body:
            'A non-goal that only says “out of scope” invites the same argument again next month. Give each one a reason and, where you can, the condition that would put it back in. That turns a refusal into a schedule, and it lets the sponsor see that you excluded the thing for a reason rather than to make your quarter easier.',
        },
        {
          kind: 'table',
          caption: 'The three Marlbrook non-goals, each with the reason and the condition that would reopen it.',
          headers: ['Non-goal for this phase', 'Why it is out', 'What would put it back in'],
          rows: [
            [
              'Sending a reply without an agent approving it',
              'The support lead will not accept it, and nobody has agreed who answers for a wrong reply',
              'A quarter of measured suggestion acceptance above a level the support lead agrees to, and a named owner for wrong replies',
            ],
            [
              'Rewriting the knowledge base',
              'A content project with a different owner and a different schedule',
              'A content owner with allocated time, tracked as its own piece of work',
            ],
            [
              'Anything that issues a refund',
              'It moves money and there is no approval path',
              'Finance names an approver and an amount limit, in writing',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'Risks belong on the same page, written as things that could happen rather than as categories. “Security risk” tells the reader nothing. “The security reviewer has not seen the design, and reading customer ticket content may need an approval we have not asked for; we find out on 20 September” tells them who, what and when. Add the discovery risks you carry from lesson one: a veto holder nobody has named, and a baseline you cannot repeat.',
        },
        {
          kind: 'prose',
          body:
            'Then put the in-scope lines in order. A list tells the sponsor what you will build; a sequence tells them what they will see first and what each later step waits on. Orosz describes OpenAI’s delivery phase as a focus on the “smallest unit possible” that results in an end-to-end solution or demo. At Marlbrook that points at the account lookup: it needs no model, it reads two systems you already know, and the one ticket you watched spent ten of its nineteen minutes there, which makes it the first thing worth measuring.',
        },
        {
          kind: 'table',
          caption: 'The three Marlbrook in-scope lines in delivery order, with what each one waits on. A dependency nobody has asked for yet belongs in the risks too.',
          headers: ['Order', 'What the operator sees when it lands', 'What it waits on'],
          rows: [
            [
              '1. Account and plan lookup',
              'The account and its plan on the ticket, or a visible “ambiguous match” with the candidates',
              'Read access from the CRM data owner, and the entitlement system’s second login replaced by a service account someone approves',
            ],
            [
              '2. Routing to tier',
              'The tier and the rule that chose it, so the support lead can dispute a rule by name',
              'The support lead confirming the whiteboard rules in writing, one test per rule',
            ],
            [
              '3. Suggested reply, agent sends',
              'A draft from a cited knowledge-base article, which the agent edits or discards',
              'The security reviewer’s decision on reading ticket content, and an agreed quality measure for drafts',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'The output of all of this is one page. The workflow as you watched it, five questions you still need answered, one baseline, the success metric, what is in and in which order, what is out, the risks and the acceptance condition. Keep the decision summary brief and link to supporting details where needed; a long document does not show that the scope is settled.',
        },
        {
          kind: 'prose',
          body:
            'Someone above the sponsor will read about this project for two minutes, on a phone, between other meetings. Vercel’s forward-deployed engineer posting expects you to report to executives: it asks for experience presenting technical discovery findings and proposals to executives at enterprise customers. Orosz describes OpenAI’s validation phase ending in a final report that shows eval performance compared to the objectives, which is the same habit: the result set beside the target agreed before.',
        },
        {
          kind: 'prose',
          body:
            'An executive update has four parts. Name the reader and what they control. List the decisions you need from them, each answerable with a yes, a no or a name, and the date you need it by. List the open questions you carry, with who owns each one. End with the next step, who takes it and when. Leave out the diary of what the team did this week; the reader needs to know what changes for them.',
        },
        {
          kind: 'code',
          language: 'text',
          code: `To: Head of Platform Engineering, Marlbrook (owns the CRM and the
    entitlement system)

Decisions I need from you
- Read access to the CRM for the account lookup: yes or no by 18 Sept.
- A named owner for the entitlement service account, by 18 Sept.

Open questions
- Can a deterministic lookup resolve shared email domains? We measure
  it on August tickets next week (support lead).
- Does reading ticket content need a separate security approval?
  Security reviewer, meeting booked for 20 Sept.

Next step
- With access by 18 Sept, the support lead sees lookups on last
  month's tickets on 25 Sept.`,
          caption: 'A fixture update to a different reader than the one in the exercise. Under a hundred words, two decisions with dates, and no history of the week.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'The postings cited here were open when they were read in October 2026, and postings close and change. They show what a few employers asked for at that moment. Nothing in this path claims that finishing it qualifies you for any role.',
        },
      ],
    },
  ],
  activities: [
    {
      id: 'fde-v1-m01-l1-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: the workflow and who is in it',
      summary: 'Observed workflow evidence, stated mechanisms and underlying needs, approval owners and the limits of a small sample.',
      competencies: ['discovery'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m01-l1',
    },
    {
      id: 'fde-v1-m01-l2-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: baseline and scope',
      summary: 'A baseline with defined data and method, a dated success metric apart from the acceptance gate, explicit exclusions and risks, a delivery sequence, and a four-part executive update.',
      competencies: ['discovery'],
      estimatedMinutes: 35,
      lessonId: 'fde-v1-m01-l2',
    },
    {
      id: 'fde-v1-m01-checks',
      kind: 'check',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Discovery decisions',
      summary: 'Four bounded decisions: making routine work observable, recognizing a measured baseline, identifying a prescribed mechanism, and resolving an explicit data-access launch gate.',
      competencies: ['discovery'],
      estimatedMinutes: 15,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-m01-q1',
          prompt:
            'The VP of Customer Operations at Marlbrook says: “The assistant should handle the routine tickets.” Nobody has defined routine. You have one hour with the support team this week. Which question do you ask first?',
          options: [
            '“Show me twenty recent tickets you would call routine, and let me watch you work three of them.”',
            '“What percentage of tickets should the assistant resolve without an agent by the end of the pilot?”',
            '“Which model would you like us to use, so we can test it against your ticket volume?”',
            '“Can you write down the wording the assistant should use for the common cases you see?”',
          ],
          correct: 0,
          explanation:
            'The word routine is doing all the work in that sentence and nobody has attached it to anything observable. Recent examples and observation make the work inspectable and provide initial timings. Twenty selected tickets and three observations are an exploratory sample, not a representative baseline by themselves; check a broader labelled mix before claiming coverage or production savings. A coverage target can be useful, but a percentage alone does not define which cases count as routine or what handling them involves. The model question picks a mechanism before the workflow and constraints are understood, and nothing in the request implies a model is needed at all. Asking for wording assumes the expensive part is composing text, which is exactly the assumption the shadowing session is there to test.',
          competencies: ['discovery'],
        },
        {
          id: 'fde-v1-m01-q2',
          prompt: 'Which hypothetical note supplies the most complete measured baseline for the Marlbrook support project?',
          options: [
            'Observed median first human reply: 19 minutes; 412 tier-1 export tickets, August; saved export query.',
            'In interviews the agents say roughly half of their day goes to answering the same questions again.',
            'Support is costing too much for a team of four, according to the finance review last quarter.',
            'Handle time will fall by 40 percent once the assistant is live, per the vendor case study.',
          ],
          correct: 0,
          explanation:
            'The measured 19-minute note carries a value and the four parts needed to interpret and repeat it: a quantity, the population it covers, the window it was taken over, and a method a different person can repeat next quarter. The agents’ estimate has no defined population and no method, and “the same questions” has never been defined, so re-measuring it after launch would measure something else. “Costing too much” has no quantity at all. A promised 40% improvement is a target, not a measured starting point; it is the sentence that goes beside the baseline once the baseline exists, and on its own there is nothing for the 40 percent to be 40 percent of.',
          competencies: ['discovery'],
        },
        {
          id: 'fde-v1-m01-q3',
          prompt: 'Four lines arrived on the Marlbrook requirements list. Which one prescribes a particular processing mechanism, rather than leaving that mechanism open behind a capability, constraint or outcome?',
          options: [
            'The assistant must summarise the whole ticket thread before the agent reads it.',
            'No message reaches a customer without a person approving it.',
            'An agent must be able to check where a suggested answer came from.',
            'Median time to first reply on tier-1 export tickets falls to 12 minutes by 31 March 2027.',
          ],
          correct: 0,
          explanation:
            'Summarising the thread before it is read prescribes a particular processing step. Clarify the underlying need, such as understanding a long thread quickly, before treating that proposal as fixed. A summary, highlighted events or a timeline may help, depending on the actual workflow; the question does not establish that they are equivalent or quantify their cost. A prescribed mechanism can become an agreed requirement, but it should be recognized as a design choice. The approval line is a constraint on the outcome and says nothing about how the approval is built. Checking where an answer came from is a capability the agent needs: an implemented citation, link or panel must actually resolve the relevant authorized evidence. Merely naming one of those controls does not satisfy it. The 12-minute deadline is the success condition: a number, a population and a date, with the implementation left open.',
          competencies: ['discovery'],
        },
        {
          id: 'fde-v1-m01-q4',
          prompt:
            'Discovery has met the sponsor, two operators and the ticket API engineer. Company policy requires customer-data access approval before launch, but nobody has identified who owns that review. Whose involvement is needed to resolve this explicit launch gate?',
          options: [
            'The owner of the required customer-data access review.',
            'A third support agent, so the shadowing covers more than two people.',
            'The frontend engineer who will build the approval screen.',
            'The sales engineer at the model provider you are considering.',
          ],
          correct: 0,
          explanation:
            'The stated policy makes this approval an explicit launch condition, so identify its owner and required evidence during discovery. More operator coverage and early frontend input can also matter; the question does not prove those people could never block delivery. A provider conversation can matter if a vendor is selected, but it does not grant the company’s customer-data approval. Do not infer permission from having met the sponsor or API engineer.',
          competencies: ['discovery'],
        },
      ],
    },
    {
      id: 'fde-v1-m01-scope-brief',
      kind: 'artifact',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'One-page scope: “add AI to support”',
      summary:
        'Turn a one-line request into a scope with a workflow, five questions, a baseline, a success metric, a sequenced scope, non-goals, risks and an acceptance condition. Recorded as self-reviewed.',
      competencies: ['discovery'],
      estimatedMinutes: 75,
      artifact: {
        brief:
          'Marlbrook Systems sells warehouse software to mid-sized distributors. Its VP of Customer Operations has sent one line: “Add AI to support.” Four agents handle roughly 400 tickets a month. The shadowing session in lesson one is the only measurement available for this submission, and it covered a single ticket. The separate multiple-choice baseline note is hypothetical; do not treat it as collected project evidence.\n\nWrite the one page that comes out of a discovery week. Nine fields, all required, each with a character limit you can see before you type: the workflow as it runs today (2,000), five questions you would ask before writing any code (1,200), the baseline (400), the success metric (600), what is in scope for this phase (1,200), the order you would deliver it in (1,200), what is not in scope (1,200), the risks (2,000), and the acceptance condition that gates launch (1,500).\n\nYou review it against two rows of the path rubric, shown beside the form: problem framing and communication.\n\nThe company, the volumes, the clock and the transcript are fixtures written for this module. There is no live system to query and no customer to interview, so where you would have to ask someone, write the question down rather than inventing the answer. Label one-ticket observations as preliminary; where a broader baseline or acceptance target has not been agreed, give a measurement/proposal plan and name the missing decision instead of claiming it already happened.\n\nThis submission is recorded as self-reviewed. The automated check confirms that each required field is present and inside its length limit, and that is the whole of what it establishes: it cannot judge whether your baseline is measurable, whether your questions would change anything, or whether you excluded the right things. Read your own answer against the problem framing and communication rows of the path rubric, then revise it before you move on.',
        fields: [
          {
            id: 'workflow',
            label: 'The workflow today',
            help:
              'Describe the ticket workflow as it runs now, step by step, with the person doing each step named by role and a time attached wherever lesson one gave you one. Say which steps you watched and which you were told about. The length check counts characters; it cannot tell whether this is the workflow the desk actually runs.',
            kind: 'long-text',
            required: true,
            maxLength: 2000,
          },
          {
            id: 'stakeholder-questions',
            label: 'Five questions to ask',
            help:
              'Five questions, one per line, that you would ask before writing any code. Each should have a named person who could answer it, and each should change what you build depending on the answer. At least one should find somebody who can refuse the project. Nothing automated can tell whether a question is a good one, so this is recorded for your own review.',
            kind: 'list',
            required: true,
            maxLength: 1200,
          },
          {
            id: 'baseline',
            label: 'Baseline',
            help:
              'Use the supplied observation only as a one-ticket preliminary measure. For a broader baseline, mark it not yet measured and specify the quantity, population, time window and repeatable method you would collect; do not invent a project-wide value. A target is not a baseline. The check only confirms this box is non-empty and inside 400 characters — whether the number can be re-measured is yours to judge.',
            kind: 'short-text',
            required: true,
            maxLength: 400,
          },
          {
            id: 'success-metric',
            label: 'Success metric',
            help:
              'The outcome you will measure after launch: the metric from your baseline, the target, the date, and one guardrail you will report beside it so a gain in speed cannot hide a loss in quality. Label it proposed until the sponsor and the support lead agree it, and name who would confirm it. The check confirms the field is filled and inside 600 characters; it cannot tell whether the number is measurable.',
            kind: 'long-text',
            required: true,
            maxLength: 600,
          },
          {
            id: 'in-scope',
            label: 'In scope for this phase',
            help:
              'One line per thing this project will deliver, each small enough that you could demonstrate it. Where deterministic code covers a line, say so; where a model earns its place, say why. Presence is checked automatically, the choices are not.',
            kind: 'list',
            required: true,
            maxLength: 1200,
          },
          {
            id: 'sequencing',
            label: 'Sequencing',
            help:
              'The in-scope lines in the order you would deliver them, one per line. For each, say what the operator sees when it lands and what it waits on: an approval, a data source, a measurement. Put the smallest slice that runs end to end first. The check tests non-empty content and total length only; it cannot judge the order.',
            kind: 'list',
            required: true,
            maxLength: 1200,
          },
          {
            id: 'non-goals',
            label: 'Non-goals',
            help:
              'One line per thing this project will not do in this phase, each with the reason and, where you can give one, the condition that would put it back in. An exclusion you did not write down is not an exclusion. The check only tests non-empty content and total length; it does not judge whether you excluded the right things.',
            kind: 'list',
            required: true,
            maxLength: 1200,
          },
          {
            id: 'risks',
            label: 'Risks',
            help:
              'What could go wrong, who would notice it, and what you would do. Cover at least the three discovery risks: a veto holder nobody has named, a baseline you cannot repeat, and a data source the security review may refuse. Add any step in your sequence that waits on a decision nobody has asked for yet. Recorded as self-reviewed; no automated check reads this for coverage.',
            kind: 'long-text',
            required: true,
            maxLength: 2000,
          },
          {
            id: 'acceptance',
            label: 'Acceptance condition',
            help:
              'The gate before this reaches the desk: what a trial on agreed tickets has to show, measured how, and who signs it. Label it proposed if the fixture has not supplied agreement; name who would confirm it. Say which slice of tickets the trial covers, since one median can improve while a ticket type gets worse. Keep it apart from the success metric, which you measure after launch. The check confirms the field is filled; the rest is your own review against the rubric.',
            kind: 'long-text',
            required: true,
            maxLength: 1500,
          },
        ],
        rubricDimensions: ['problem-framing', 'communication'],
      },
    },
    {
      id: 'fde-v1-m01-exec-update',
      kind: 'artifact',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Executive update: the end of discovery week',
      summary:
        'Write the update a Marlbrook executive reads in two minutes: the audience, the decisions you need, the open questions and the next step, in four fields with their own limits (200, 600, 600 and 300 characters, 1,700 in all). Recorded as self-reviewed.',
      competencies: ['discovery'],
      estimatedMinutes: 30,
      artifact: {
        brief:
          'It is the Friday of the Marlbrook discovery week. The VP of Customer Operations, who sent “Add AI to support”, meets the chief operating officer on Monday to decide whether the project keeps its budget, and has asked you for an update to forward.\n\nWhat the fixtures give you: one shadowed ticket took nineteen minutes, ten of them on finding the account and its plan. Your scope brief proposes the account lookup first, then routing, then a suggested reply that an agent sends. The security reviewer has not seen the design. The CRM data owner has not granted read access. Finance has not named an approver for anything that moves money, so refunds stay a non-goal. Nobody has agreed a success metric yet. Use only these facts; where you would need an answer you do not have, list it as an open question with an owner.\n\nFour fields, all required, each with its own character limit so the update fits on a phone screen: the audience (200), the decisions you need (600), the open questions (600) and the next step (300), 1,700 in all. Each limit applies to its own field; a list field counts every line and the line breaks between them. Choose whether you write to the VP or to the chief operating officer, and say so in the audience field. You review it against two rows of the path rubric, shown beside the form: communication and problem framing.\n\nMarlbrook, its people and its numbers are fixtures written for this module. This submission is recorded as self-reviewed. The automated check confirms that each field is present and inside its limit, and nothing more: it cannot tell whether a decision is answerable or whether the reader would know what to do next. Read your update as the person receiving it would, against the rubric, and cut anything that reader does not need.',
        fields: [
          {
            id: 'audience',
            label: 'Audience',
            help:
              'Who reads this, what they control, and what they need from it in one or two sentences. Name a role, not a person. The check confirms the field is filled and inside 200 characters.',
            kind: 'short-text',
            required: true,
            maxLength: 200,
          },
          {
            id: 'decisions',
            label: 'Decisions you need',
            help:
              'One decision per line, each answerable with a yes, a no or a name, with the date you need it by and what slips if it comes later. Two or three is plenty. The check tests non-empty content and a total of 600 characters; it cannot tell whether a line is a decision or a status report.',
            kind: 'list',
            required: true,
            maxLength: 600,
          },
          {
            id: 'open-questions',
            label: 'Open questions',
            help:
              'One question per line that you cannot answer yet, with the role that owns the answer and when you expect it. Do not invent answers the fixtures do not give. The check tests non-empty content and a total of 600 characters.',
            kind: 'list',
            required: true,
            maxLength: 600,
          },
          {
            id: 'next-step',
            label: 'Next step',
            help:
              'The next thing that happens, who does it and when, written so the reader knows what they will see next. The check confirms the field is filled and inside 300 characters.',
            kind: 'short-text',
            required: true,
            maxLength: 300,
          },
        ],
        rubricDimensions: ['communication', 'problem-framing'],
      },
    },
  ],
  requires: [
    { activityId: 'fde-v1-m01-checks', state: 'verified_pass' },
    { activityId: 'fde-v1-m01-scope-brief', state: 'self_reviewed' },
    { activityId: 'fde-v1-m01-exec-update', state: 'self_reviewed' },
  ],
};
