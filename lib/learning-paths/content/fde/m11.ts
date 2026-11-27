/** M11 (temporary id `fde-v1-m11-deploy`): Deploy in the customer's environment.
 *
 * M10 kept a model's proposal from acting with authority it does not have.
 * This module ships the result into somebody else's cloud account: their
 * network, their identity system, their change window and their database.
 * B9 renumbers the manifest later; until then the module keeps the id the
 * issue (#504) names, and every activity id carries it.
 *
 * Two lessons, one six-question check, one graded TypeScript release gate.
 * The first lesson reads a Dockerfile and the four cloud primitives a
 * customer's platform team asks about: compute, storage, networking and
 * identity, with the private endpoint that keeps traffic off the internet.
 * The second reads a Terraform plan, names the gates a release passes, and
 * prices a rollback after the schema moved.
 *
 * Everything here is an authored fixture. The Dockerfiles, the plan output,
 * the probe results, the migration ids and the restore point are written for
 * this path. Nothing calls a cloud API, needs a vendor account or opens a
 * socket. The lessons name one cloud's services so the vocabulary is concrete;
 * no check names a product as its answer. */

import type { ModuleSource } from '../../types';

/** The release candidates and the recording log the gate is graded against.
 * Immutable helpers are supplied before learner declarations; the harness
 * calls `gateRelease` only when a graded call runs.
 *
 * `__candidate(overrides)` copies a clean candidate that should roll out and
 * replaces the fields a test names. `__log()` returns a log whose `record`
 * keeps a JSON copy of each entry, so a later change to an array the learner
 * returned cannot rewrite what was recorded. `__gate(overrides)` runs the gate
 * once against a fresh candidate and a fresh log and hands back both.
 * `SIGNING_KEY` carries the value `FIXTURE-SECRET-7731` so a test can prove
 * that no reason and no record repeats a configuration value. */
const RELEASE_FIXTURES = `
var __candidate = function (overrides) {
  var base = {
    release: 'R-2026.10.3',
    checkedAt: '2026-10-21T09:30:00Z',
    requiredConfig: ['DATABASE_URL', 'QUEUE_URL', 'SIGNING_KEY'],
    health: [
      { instance: 'web-1', status: 'ready' },
      { instance: 'web-2', status: 'ready' }
    ],
    config: [
      { key: 'DATABASE_URL', state: 'ok', value: 'postgres://cases-db.internal.example/ops' },
      { key: 'QUEUE_URL', state: 'ok', value: 'https://queue.internal.example/cases' },
      { key: 'SIGNING_KEY', state: 'ok', value: 'FIXTURE-SECRET-7731' }
    ],
    migrations: [
      { id: '0042_add_case_priority', status: 'applied', reversible: true }
    ],
    restorePoint: null
  };
  var out = {};
  for (var key in base) out[key] = base[key];
  var extra = overrides || {};
  for (var patch in extra) out[patch] = extra[patch];
  return out;
};
var __log = function () {
  var entries = [];
  return {
    record: function (entry) { entries.push(JSON.parse(JSON.stringify(entry))); },
    entries: entries
  };
};
var __gate = function (overrides) {
  var log = __log();
  var out = gateRelease(__candidate(overrides), log);
  return { out: out, log: log.entries };
};
`.trim();

const RELEASE_TYPES = `interface HealthProbe {
  instance: string;
  status: string;
}

interface ConfigProbe {
  key: string;
  state: string;
  value?: string;
}

interface MigrationReport {
  id: string;
  status: string;
  reversible: boolean;
}

interface ReleaseCandidate {
  release: string;
  checkedAt: string;
  requiredConfig: string[];
  health: HealthProbe[] | null;
  config: ConfigProbe[] | null;
  migrations: MigrationReport[] | null;
  restorePoint: string | null;
}

type Decision = 'rollout' | 'hold';

interface GateDecision {
  decision: Decision;
  release: string;
  reasons: string[];
}

interface DecisionRecord {
  release: string;
  decision: Decision;
  reasons: string[];
  checkedAt: string;
}

interface DecisionLog {
  record(entry: DecisionRecord): void;
}`;

const SCRATCH_PAD = `// Scratch pad: change this before submitting.
const demoLog: DecisionLog = { record: (entry) => console.log('recorded', JSON.stringify(entry)) };
console.log(JSON.stringify(gateRelease({
  release: 'R-2026.10.4',
  checkedAt: '2026-10-22T08:00:00Z',
  requiredConfig: ['DATABASE_URL', 'SIGNING_KEY'],
  health: [],
  config: [{ key: 'DATABASE_URL', state: 'ok' }],
  migrations: [{ id: '0043_drop_legacy_priority', status: 'pending', reversible: false }],
  restorePoint: null,
}, demoLog)));
`;

const CLEAN_RECORD = {
  release: 'R-2026.10.3',
  decision: 'rollout',
  reasons: [],
  checkedAt: '2026-10-21T09:30:00Z',
};

export const FDE_M11: ModuleSource = {
  id: 'fde-v1-m11',
  title: 'Deploy in the customer’s environment',
  outcomes: [
    'Read a Dockerfile the way a customer’s platform reviewer does: the base image, the user the process runs as, the health check, and where a secret could end up in a layer.',
    'Describe a deployment in the customer’s own cloud account in four primitives (compute, storage, networking and identity) and say which one each of their questions is about.',
    'Keep the workload’s identity to a role with temporary credentials and the narrowest actions it needs, and keep its traffic on a private endpoint when the customer forbids the public internet.',
    'Read a Terraform plan before anyone applies it, and spot the line that destroys and recreates a resource holding data.',
    'Write a release gate that refuses a rollout on failed health, configuration or migration evidence, records why, and prices the rollback before the schema moves.',
  ],
  competencies: ['deployment'],
  dependsOn: ['fde-v1-m04', 'fde-v1-m10'],
  estimatedMinutes: 125,
  lessons: [
    {
      id: 'fde-v1-m11-deploy-l1',
      title: 'Containers, cloud primitives and the private network',
      summary:
        'What a customer’s platform team checks in your Dockerfile, the four cloud primitives every deployment conversation comes back to, and how a private endpoint and a scoped role keep the workload inside the boundary they drew.',
      estimatedMinutes: 25,
      sources: [
        {
          label: 'Docker docs: Building best practices',
          url: 'https://docs.docker.com/build/building/best-practices/',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Docker docs: Build secrets',
          url: 'https://docs.docker.com/build/building/secrets/',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Docker docs: Dockerfile reference',
          url: 'https://docs.docker.com/reference/dockerfile/',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'AWS docs: What is AWS PrivateLink?',
          url: 'https://docs.aws.amazon.com/vpc/latest/privatelink/what-is-privatelink.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'AWS docs: Security best practices in IAM',
          url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Amazon ECS docs: Determine Amazon ECS task health using container health checks',
          url: 'https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Sierra: Forward Deployed Infrastructure Engineer (job posting)',
          url: 'https://jobs.ashbyhq.com/sierra/d9c0aa93-e35d-4752-9cef-4c39dcad5365',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Google Careers: Staff Forward Deployed Engineer, Developer AI, Google Cloud (job posting)',
          url: 'https://www.google.com/about/careers/applications/jobs/results/83353124541997766',
          reviewedOn: '2026-10-21',
        },
      ],
      sections: [
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Before this module: the DevOps & Cloud topic in Learn covers CI/CD, containers and observability at the level this module assumes. If a Dockerfile or a pipeline stage is new to you, work through its levels first. This module builds on them and does not repeat them.',
        },
        {
          kind: 'prose',
          body:
            'Marlbrook’s security team has one rule for the support workbench: ticket data stays in Marlbrook’s own cloud account. So you do not deploy to your company’s infrastructure. You hand Marlbrook’s platform team a container image and an infrastructure module, they review both, and their pipeline runs them in a network you cannot see from the outside.',
        },
        {
          kind: 'prose',
          body:
            'Employers write this into FDE postings. Sierra’s Forward Deployed Infrastructure Engineer posting asks for deployment strategies across customer environments, “including VPC configuration, permissioning, networking, and infrastructure provisioning”, and for experience with security reviews, compliance requirements and change management in customer-owned cloud environments. Google’s Staff FDE posting for Developer AI describes the work as code that connects Google’s AI products to a customer’s live infrastructure, “including APIs, legacy data silos, and security perimeters”.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'This lesson uses one cloud’s names (AWS: VPC, IAM roles, PrivateLink) so the vocabulary is concrete. Every large cloud has the same four primitives under other names. You need no account for anything here: the Dockerfiles, plans and policies are fixtures written for this path, and no question asks you to pick a product.',
        },
        {
          kind: 'code',
          language: 'dockerfile',
          code: "# syntax=docker/dockerfile:1\nFROM node:22-bookworm-slim@sha256:<digest your build pins> AS build\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build && npm prune --omit=dev\n\nFROM node:22-bookworm-slim@sha256:<digest your build pins>\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=build /app/dist ./dist\nCOPY --from=build /app/node_modules ./node_modules\nUSER node\nEXPOSE 8080\nHEALTHCHECK --interval=30s --timeout=5s --retries=3 \\\n  CMD node dist/healthcheck.js\nCMD [\"node\", \"dist/server.js\"]",
          caption: 'The workbench image as Marlbrook’s reviewer receives it. The digest is left as a placeholder here; a real build pins the one it tested. No secret appears in any line.',
        },
        {
          kind: 'table',
          caption: 'Five lines of that Dockerfile, the question a platform reviewer asks about each, and what the Docker documentation says.',
          headers: ['Line', 'The reviewer’s question', 'What the Docker docs say'],
          rows: [
            [
              '`FROM …@sha256:…`',
              'Will the image you build next month contain what we approved?',
              'Pinning the base image to a digest means the build always uses the same image version.',
            ],
            [
              'Two `FROM` stages',
              'Does the runtime image carry your compiler and dev dependencies?',
              'Multi-stage builds reduce the size of the final image. Here the first stage builds and then prunes its dev dependencies with `npm prune --omit=dev`, so the second stage copies only what runs.',
            ],
            [
              '`USER node`',
              'Does the process run as root inside the container?',
              'If a service can run without privileges, use `USER` to change to a non-root user.',
            ],
            [
              '`HEALTHCHECK`',
              'How will our platform know the container stopped working?',
              '`HEALTHCHECK` tells Docker how to test that a container still works; exit code 0 means healthy and 1 means unhealthy. The customer’s orchestrator may ignore it: Amazon ECS does not monitor a health check embedded in the image unless the container definition specifies one, so you hand their platform team the command for that definition.',
            ],
            [
              'No `ARG` or `ENV` holding a token',
              'Can anyone who pulls the image read your credentials?',
              '`ENV` values persist in the built image, and `ARG` values show up in `docker history`. Pass build-time secrets through a secret mount instead.',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'Marlbrook’s reviewer reads the image before they read your code, because the image is what runs with their data. A process running as root, a base image that changes under the same tag, or a token baked into a layer each gives them a reason to stop the review. You fix all three in the Dockerfile, before the meeting.',
        },
        {
          kind: 'table',
          caption: 'The four primitives a deployment conversation keeps returning to, the question Marlbrook’s platform team asks about each, and what you bring to answer it.',
          headers: ['Primitive', 'Their question', 'What you bring'],
          rows: [
            [
              'Compute',
              'Where does the container run, how many copies, and who restarts it?',
              'The image, its health check, the instance count you tested, and its CPU and memory needs.',
            ],
            [
              'Storage',
              'Which buckets and databases does it read and write, and who else can?',
              'A list of every store by name, with the actions the workload needs on each one.',
            ],
            [
              'Networking',
              'Which addresses does it call, and does any traffic leave our network?',
              'Every outbound destination, the port, and whether a private endpoint can carry it.',
            ],
            [
              'Identity',
              'Which identity does the workload use, and what can that identity do?',
              'One role per workload, the policy attached to it, and no long-lived key anywhere.',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'Identity decides the size of a mistake. AWS’s IAM guidance asks workloads to use temporary credentials through IAM roles, so nobody distributes a long-lived access key, and to grant only the actions a task needs on specific resources under specific conditions. A role that can read one bucket can leak one bucket. A deploy user with an administrator policy can do anything the account can.',
        },
        {
          kind: 'code',
          language: 'json',
          code: '{\n  "Version": "2012-10-17",\n  "Statement": [\n    {\n      "Effect": "Allow",\n      "Action": ["s3:GetObject"],\n      "Resource": "arn:aws:s3:::marlbrook-kb-exports/published/*"\n    }\n  ]\n}',
          caption: 'A fixture policy for the workbench role: read objects under one prefix of one bucket, nothing else. The bucket and prefix are invented for this path.',
        },
        {
          kind: 'prose',
          body:
            'Networking decides where the data can travel. Marlbrook runs the workbench in private subnets with no public address. When it calls your company’s API, that traffic should not cross the internet either. AWS PrivateLink connects a VPC to a service “as if” the service sat inside the VPC, with no internet gateway, NAT device or public IP address in the path. The customer then controls exactly which endpoints the private subnets can reach.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'A secret in the image is a secret in every registry and on every machine that pulled it. Docker’s build-secrets page says build arguments and environment variables persist in the final image, which is why it recommends secret mounts. At runtime, the workload should read credentials from the customer’s secret store through its role, so rotating a secret never requires a new image.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Every Dockerfile, policy and network rule on this page is a fixture. You did not deploy anything, and no cloud account recorded a change. The check and the exercise grade your reading of these fixtures, which tells you how you read them, not how a particular customer’s platform behaves.',
        },
      ],
    },
    {
      id: 'fde-v1-m11-deploy-l2',
      title: 'Infrastructure as code, release gates and rollback cost',
      summary:
        'How to read a Terraform plan before it runs, which gates a release passes on its way into the customer’s account, and what a rollback costs once a migration has changed the schema.',
      estimatedMinutes: 25,
      sources: [
        {
          label: 'Terraform docs: terraform plan command',
          url: 'https://developer.hashicorp.com/terraform/cli/commands/plan',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Terraform tutorial: Create a Terraform plan',
          url: 'https://developer.hashicorp.com/terraform/tutorials/cli/plan',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Terraform docs: The lifecycle meta-argument',
          url: 'https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Terraform docs: Manage sensitive data',
          url: 'https://developer.hashicorp.com/terraform/language/manage-sensitive-data',
          reviewedOn: '2026-11-27',
        },
        {
          label: 'Google SRE Workbook: Canarying releases',
          url: 'https://sre.google/workbook/canarying-releases/',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Danilo Sato (martinfowler.com): Parallel Change',
          url: 'https://martinfowler.com/bliki/ParallelChange.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Sierra: Forward Deployed Infrastructure Engineer (job posting)',
          url: 'https://jobs.ashbyhq.com/sierra/d9c0aa93-e35d-4752-9cef-4c39dcad5365',
          reviewedOn: '2026-10-21',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'Marlbrook’s platform team will not run your Terraform blind. They run `terraform plan`, read it, and approve it. The Terraform docs describe what plan does: it reads the current state of existing remote objects, compares the configuration with that state, and proposes the changes that would make them match. Plan alone changes nothing. So the plan is the document you and the reviewer argue over.',
        },
        {
          kind: 'code',
          language: 'text',
          code: 'Terraform will perform the following actions:\n\n  # aws_db_instance.cases must be replaced\n-/+ resource "aws_db_instance" "cases" {\n      ~ storage_encrypted = false -> true # forces replacement\n        # (14 unchanged attributes hidden)\n    }\n\n  # aws_security_group.workbench will be updated in-place\n  ~ resource "aws_security_group" "workbench" {\n      ~ ingress = [\n          + {\n              + cidr_blocks = ["10.40.0.0/16"]\n              + from_port   = 8080\n              + to_port     = 8080\n              + protocol    = "tcp"\n            },\n        ]\n    }\n\nPlan: 1 to add, 1 to change, 1 to destroy.',
          caption: 'A fixture plan for a release that only meant to open port 8080 to Marlbrook’s internal range. An encryption setting slipped in beside it.',
        },
        {
          kind: 'table',
          caption: 'The plan symbols in that output, what Terraform will do, and the question you ask before anyone types apply.',
          headers: ['Symbol', 'What apply will do', 'Your question'],
          rows: [
            ['`+`', 'Create a new object', 'Did we mean to create it, and who pays for it?'],
            ['`~`', 'Change an existing object in place', 'Does the change widen access, as this ingress rule does?'],
            ['`-`', 'Destroy an object', 'What does the object hold, and where is the copy?'],
            ['`-/+` with `# forces replacement`', 'Destroy the object, then create a new one', 'Does this object hold data? Then this line loses it.'],
          ],
        },
        {
          kind: 'prose',
          body:
            'Read the summary line before the details. “1 to destroy” in a release that only meant to open a port tells you something else changed. Here turning on storage encryption for the database forces replacement, and the Terraform lifecycle docs say the default for a replacement is to destroy the existing object first and then create the new one. The case database would come back empty. Two lifecycle settings change that: `prevent_destroy = true` makes Terraform reject any plan that would destroy the object, and `create_before_destroy` builds the replacement first. Neither copies the data across.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'Apply the plan the reviewer approved, not a fresh one. `terraform plan -out` writes the plan to a file that `terraform apply` accepts, so the change that runs is the change somebody read. That file holds the full configuration in cleartext, and Terraform state stores any secret you put in the configuration. Treat both as sensitive: keep them out of Git, in remote storage with access controls and audit logs.',
        },
        {
          kind: 'prose',
          body:
            'A release gate is a check that can say no, and a pipeline that cannot refuse has no gates. For a deployment into Marlbrook’s account, four gates run in order: the image builds from pinned inputs and passes its tests, a person approves the saved plan, the migration job reports every migration applied, and a canary answers its health checks with the release’s configuration in place. Only then does the rollout start. The SRE Workbook defines canarying as a partial, time-limited deployment of a change and its evaluation against the rest of the service, with a pause and rollback when the canary drifts too far from the control.',
        },
        {
          kind: 'prose',
          body:
            'Change management is the customer’s process for the same idea. Marlbrook’s change board approves a change window, a description of the change and a rollback plan. Sierra’s posting lists “change management processes” beside security reviews among the things an FDE navigates in customer-owned cloud environments, and asks for engineers who “think about upgrades, rollbacks, monitoring, and failure modes from the start”. Write the rollback before the change, because the board asks for it and because an incident is the worst hour to design one.',
        },
        {
          kind: 'prose',
          body:
            'A rollback costs nothing until a migration has run. Redeploying the previous image restores the previous code; it restores no column, no row and no message already sent. Danilo Sato’s article on Martin Fowler’s site describes parallel change, also called expand and contract, as the pattern for backward-incompatible changes: expand the interface so it supports old and new versions, migrate every client, then contract to remove the old version. For a schema, “contract” is the step that drops a column.',
        },
        {
          kind: 'table',
          caption: 'The three phases of a schema change, whether you can still roll the code back, and what that rollback costs.',
          headers: ['Phase', 'Old code still works?', 'Rollback cost'],
          rows: [
            ['Expand: add `priority` beside `legacy_priority`; no code reads or writes it yet', 'Yes, it ignores the new column', 'Redeploy the old image. The new column is still empty, so nothing is lost.'],
            ['Migrate: new code writes both, reads `priority`', 'Yes, `legacy_priority` stays filled', 'Redeploy the old image. Nothing to restore.'],
            ['Contract: drop `legacy_priority`', 'No, it reads a column that no longer exists', 'Restore from a restore point taken before the drop, and lose writes made after it.'],
          ],
        },
        {
          kind: 'trace',
          caption: 'Release R-2026.10.3 through its gates in Marlbrook’s account. The contract migration waits for a later release, after no running code reads the old column.',
          trace: {
            shape: 'array',
            legend: ['pinned build and tests', 'saved plan approved', 'migrations applied', 'canary healthy', 'rollout'],
            frames: [
              {
                cells: ['passed', 'waiting', 'waiting', 'waiting', 'waiting'],
                marks: [{ index: 0, role: 'settled' }, { index: 1, role: 'active' }],
                note: 'The image builds from a pinned base digest and its tests pass. The plan waits for Marlbrook’s reviewer.',
              },
              {
                cells: ['passed', 'passed', 'waiting', 'waiting', 'waiting'],
                marks: [{ index: 1, role: 'settled' }, { index: 2, role: 'active' }],
                note: 'The reviewer approves a saved plan with 0 to destroy, after the encryption change came out of the release.',
              },
              {
                cells: ['passed', 'passed', 'passed', 'waiting', 'waiting'],
                marks: [{ index: 2, role: 'settled' }, { index: 3, role: 'active' }],
                note: 'The migration job reports 0042_add_case_priority applied. It is an expand step, so the previous release still runs against this schema.',
              },
              {
                cells: ['passed', 'passed', 'passed', 'passed', 'waiting'],
                marks: [{ index: 3, role: 'settled' }, { index: 4, role: 'active' }],
                note: 'Both canary instances answer their health checks with every required configuration key present.',
              },
              {
                cells: ['passed', 'passed', 'passed', 'passed', 'rolled out'],
                marks: [{ index: 4, role: 'settled' }],
                note: 'The gate records the decision with no reasons. Dropping legacy_priority waits for a later release, behind its own restore point.',
              },
            ],
          },
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'The plan output, the migration ids, the canary results and the change board on this page are fixtures. In the exercise, health probes, configuration probes and migration reports arrive as data and the log records into memory. A passing gate shows how your code decides on these inputs. It does not show that any real rollout was safe.',
        },
      ],
    },
  ],
  activities: [
    {
      id: 'fde-v1-m11-deploy-l1-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: containers, cloud primitives and the private network',
      summary: 'A Dockerfile through a platform reviewer’s eyes, the four cloud primitives, scoped roles and private endpoints.',
      competencies: ['deployment'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m11-deploy-l1',
    },
    {
      id: 'fde-v1-m11-deploy-l2-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: infrastructure as code, release gates and rollback cost',
      summary: 'Reading a Terraform plan, the gates a release passes, change management, and expand and contract migrations.',
      competencies: ['deployment'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m11-deploy-l2',
    },
    {
      id: 'fde-v1-m11-deploy-checks',
      kind: 'check',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Dockerfiles, plans and the rollback',
      summary: 'Six questions that read a Dockerfile, two Terraform fixtures and a migration history from a deployment into a customer’s account.',
      competencies: ['deployment'],
      estimatedMinutes: 20,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-m11-deploy-q1',
          prompt:
            'Marlbrook’s reviewer rejects this Dockerfile before reading anything else. The workbench needs the token only to download a private package during the build. Which change answers the objection?',
          context: {
            language: 'dockerfile',
            code: 'FROM node:22-bookworm-slim@sha256:<pinned digest>\nARG PACKAGE_TOKEN\nENV PACKAGE_TOKEN=$PACKAGE_TOKEN\nWORKDIR /app\nCOPY . .\nRUN npm ci && npm run build\nUSER node\nCMD ["node", "dist/server.js"]',
          },
          options: [
            'Delete the `ENV` line and keep the token as a build argument, since `ARG` values are not embedded in the final image.',
            'Pass the token through a build secret mount on the `RUN` step, so the build sees it and no layer or history entry keeps it.',
            'Keep both lines and add `PACKAGE_TOKEN` to `.dockerignore`, so the build context never copies the token into the image.',
            'Move the `ARG` and `ENV` lines below `USER node`, so only the unprivileged runtime user can read the token.',
          ],
          correct: 1,
          explanation:
            'A secret mount makes the token available to that one build instruction and leaves it out of the image, which is what Docker’s build-secrets page recommends. Dropping `ENV` helps but leaves the problem: Docker’s reference says build arguments appear in `docker history`. `.dockerignore` excludes files from the build context; the token arrives as an argument, not a file, so it has nothing to exclude. Moving the lines below `USER` changes which user runs later steps, not where the value lives: `ENV` still persists in the image for anyone who pulls it, and `npm ci` would then run before the token exists.',
          competencies: ['deployment'],
        },
        {
          id: 'fde-v1-m11-deploy-q2',
          prompt:
            'This release was meant to open port 8080 to Marlbrook’s internal range and nothing else. The case database holds three years of tickets. What happens if someone applies this plan, and what do you do?',
          context: {
            language: 'text',
            code: '  # aws_db_instance.cases must be replaced\n-/+ resource "aws_db_instance" "cases" {\n      ~ storage_encrypted = false -> true # forces replacement\n    }\n\n  # aws_security_group.workbench will be updated in-place\n  ~ resource "aws_security_group" "workbench" { ... }\n\nPlan: 1 to add, 1 to change, 1 to destroy.',
          },
          options: [
            'Terraform encrypts the database in place and keeps its data, since only a storage setting changes. Apply it during the next change window.',
            'Terraform builds the new database first and then removes the old one, so the tickets move across. Apply it and check the row count.',
            'Terraform destroys the database and creates an empty one. Stop the apply, drop the encryption change, and get a plan with nothing to destroy.',
            'Terraform changes only its state file for the setting, so no remote object changes. Apply it and run a refresh afterwards.',
          ],
          correct: 2,
          explanation:
            '`-/+` with `# forces replacement` means Terraform cannot change `storage_encrypted` in place, and the lifecycle docs say a replacement destroys the existing object first and then creates a new one. The release did not ask for a database change, so you drop the encryption change and approve a plan that destroys nothing; encrypting the database becomes its own planned change, with a copy of the data. An in-place update would show `~`, not `-/+`. Create-before-destroy only applies when the configuration sets `create_before_destroy`, and even then Terraform builds a new empty object; it copies no data. A plan that touched only state would propose no action on a remote object; this one proposes replacing the database.',
          competencies: ['deployment'],
        },
        {
          id: 'fde-v1-m11-deploy-q3',
          prompt:
            'The workbench container reads exported articles from one prefix of one bucket in Marlbrook’s account and writes nothing there. Which identity setup should you hand their platform team?',
          context: {
            language: 'hcl',
            code: 'resource "aws_iam_role_policy" "workbench_read" {\n  role = aws_iam_role.workbench.id\n  policy = jsonencode({\n    Version = "2012-10-17"\n    Statement = [{\n      Effect   = "Allow"\n      Action   = ["s3:*"]\n      Resource = "*"\n    }]\n  })\n}',
          },
          options: [
            'Keep this policy on the role for the pilot and narrow it once traffic shows which actions the workbench uses.',
            'Replace the role with an access key for a dedicated deploy user, stored in the container’s environment and rotated quarterly.',
            'Keep the role, and limit the policy to reading objects under the one prefix the workbench uses, with no write action.',
            'Keep this policy and add a network rule so only the workbench’s private subnet can reach the storage service.',
          ],
          correct: 2,
          explanation:
            'A role gives the workload temporary credentials, and a policy limited to reading one prefix grants only what the task needs, which is the IAM least-privilege practice. The fixture policy grants every storage action on every resource in the account. Starting broad and narrowing later is a path AWS describes for exploration, but here you already know the one action and the one prefix, so the pilot would carry access nobody needs. A long-lived access key in the environment is what the IAM guidance tells workloads to avoid. A network rule limits where requests come from; it leaves the identity able to delete or overwrite every object it can reach.',
          competencies: ['deployment'],
        },
        {
          id: 'fde-v1-m11-deploy-q4',
          prompt:
            'Marlbrook runs the workbench in private subnets with no public addresses, and its policy forbids ticket data from crossing the public internet. The workbench must call your company’s classification API. Which design meets the policy?',
          options: [
            'Give the workbench a public address and let your API accept calls only from that address.',
            'Route the calls through a NAT device whose egress firewall allows only your API’s hostname.',
            'Reach your API through a private endpoint in Marlbrook’s network, with no internet path in between.',
            'Open a site-to-site VPN from Marlbrook’s network to your office and forward the calls from there.',
          ],
          correct: 2,
          explanation:
            'A private endpoint connects the VPC to the service as if it sat inside the VPC, with no internet gateway, NAT device or public IP address in the path, and the customer controls which endpoints the subnets can reach. An address allow-list restricts who may call, but the traffic still crosses the internet. A NAT device with an egress filter limits where traffic may go and still sends it out to the internet. A VPN to your office moves the data into a network Marlbrook does not control, and your office then forwards it over the internet to the API.',
          competencies: ['deployment'],
        },
        {
          id: 'fde-v1-m11-deploy-q5',
          prompt:
            'Release 42 shipped code that reads only `priority` and, in the same release, a migration that dropped `legacy_priority`. Release 41 reads `legacy_priority`. The release 42 canary is failing. What does redeploying release 41 do?',
          options: [
            'It restores the previous code and the previous schema, because the release pipeline versions the image and the migrations together.',
            'It restores the previous code, which fails on a column the database no longer has. Recovery needs a restore point from before the drop.',
            'It restores the previous code, and the database recreates `legacy_priority` from its migration history on the next connection.',
            'It restores the previous code, and Terraform puts the column back on the next apply because its state recorded the old schema.',
          ],
          correct: 1,
          explanation:
            'Redeploying an image restores code only. Release 41 reads a column that release 42’s migration removed, so it fails too, and getting the data back means restoring from a point taken before the drop and losing writes since then. Expand and contract avoids this by dropping the column a release later, once no running code reads it. A pipeline that versions code and migrations together still runs the drop forward; it does not undo it. A database does not replay its migration history on connect. Terraform state tracks the infrastructure objects it manages, such as the database instance, not the columns inside it.',
          competencies: ['deployment'],
        },
        {
          id: 'fde-v1-m11-deploy-q6',
          prompt:
            'Marlbrook’s change board approved the plan you showed on Monday for Thursday’s window. On Thursday a colleague proposes running `terraform apply` straight from the main branch. What should run instead?',
          options: [
            '`terraform apply` from the main branch, since it plans again first and so reflects the latest state of the account.',
            '`terraform apply` with the plan file saved by `terraform plan -out` on Monday, kept where only the release role can read it.',
            '`terraform apply -auto-approve` from the main branch, so nobody can approve something different by mistake during the window.',
            '`terraform plan` again on Thursday, and apply if its summary line shows the same counts as Monday’s plan did.',
          ],
          correct: 1,
          explanation:
            'A plan saved with `-out` is the exact change the board read, and `terraform apply` accepts that file, so what runs is what was approved. The Terraform docs note the saved file holds the configuration in cleartext, so you store it with access controls. A fresh apply plans again, and anything merged or changed since Monday would run without review. `-auto-approve` removes the last prompt and leaves the same unreviewed plan. Matching summary counts can hide different changes: one destroyed security group and one destroyed database both read “1 to destroy”.',
          competencies: ['deployment'],
        },
      ],
    },
    {
      id: 'fde-v1-m11-deploy-release-gate',
      kind: 'code',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'A release gate that refuses and records why',
      summary:
        'Write the TypeScript gate that decides whether a release rolls out in the customer’s account. Graded on failed health, missing or invalid configuration, unapplied or unprotected migrations, and a record of every decision.',
      competencies: ['deployment'],
      estimatedMinutes: 55,
      code: {
        language: 'typescript',
        prompt:
          'Marlbrook’s pipeline calls `gateRelease(candidate, log)` once per release, after the canary has run and before traffic moves. The version you have been given rolls out releases it should stop. Rewrite it.\n\n`candidate` is the evidence the pipeline collected, typed as `ReleaseCandidate`. `health` holds one probe per canary instance as `{ instance, status }`. `config` holds one probe per configuration key as `{ key, state, value? }`. `migrations` holds one report per migration in this release as `{ id, status, reversible }`. `requiredConfig` lists the keys this release needs, and `restorePoint` names the database snapshot taken before the release, or is `null`. The statuses and states arrive from other systems as plain strings, so expect values you have not seen.\n\nCollect every reason to hold, as a string, by these rules:\n\n1. **Health.** If `health` is `null` or empty, the reason is `health:no-probes`: no evidence is not a pass. Every probe whose `status` is not exactly `ready` adds `health:<instance>:<status>`.\n2. **Configuration.** If `config` is `null`, the reason is `config:no-report`. Otherwise, for every key in `requiredConfig`: no probe for that key adds `config:<key>:missing`, and a probe whose `state` is not exactly `ok` adds `config:<key>:<state>`. Probes for keys the release does not require never hold it. A reason names the key and never the value: values include secrets.\n3. **Migrations.** If `migrations` is `null`, the migration check never ran, and the reason is `migration:no-report`. An empty array means this release has no migrations. Every migration whose `status` is not exactly `applied` adds `migration:<id>:<status>`. Separately, every migration whose `reversible` is not `true` adds `migration:<id>:irreversible-without-restore-point` unless `restorePoint` is a non-blank string.\n\nRemove duplicate reasons and sort them with the default string sort. With no reasons the decision is `rollout`; with any reason it is `hold`.\n\nThen record why. Call `log.record` exactly once, for a rollout as well as a hold, with `{ release, decision, reasons, checkedAt }` copied from the candidate and your result. Return `{ decision, release, reasons }`.\n\nEvery probe, report and log here is an authored fixture. `__candidate`, `__log` and `__gate` are immutable helpers the grader provides: a clean candidate that should roll out, a log that keeps a copy of each entry, and a runner that pairs them. Nothing calls a cloud API, reads a real database or deploys anything, so a passing grade says how your code decides on these inputs, not that any real rollout was safe.\n\nDomain: at most 1,000 probes, keys and migrations; ids, keys, instances, statuses and states are non-empty strings of at most 200 characters; keys are unique within `config`. `log.record` never throws. Do not mutate the candidate.',
        contract: [
          'Keep the supplied type names and the `gateRelease(candidate, log)` signature; the type assertions use them by name.',
          'A missing report (`null`) is a reason to hold, never a pass. An empty migration list is a release without migrations; an empty probe list is a release without health evidence.',
          'A reason names a key, an instance or a migration id, and never a configuration value.',
          'Call `log.record` exactly once per call, for a rollout as well as a hold, and return the same reasons you recorded.',
          'No imports, no network and no clock: `checkedAt` comes from the candidate. Do not mutate the candidate.',
          '`__candidate`, `__log` and `__gate` are immutable fixture helpers supplied by the grader. Do not redefine them.',
        ],
        starter: `${RELEASE_TYPES}

const gateRelease = (candidate: ReleaseCandidate, log: DecisionLog): GateDecision => {
  const reasons: string[] = [];

  // "Every probe that answered was fine."
  if (!(candidate.health ?? []).every((probe) => probe.status !== 'not_ready')) {
    reasons.push('health:failing');
  }

  for (const probe of candidate.config ?? []) {
    if (probe.state === 'invalid') reasons.push(\`config:\${probe.key}:\${probe.value}\`);
  }

  for (const migration of candidate.migrations ?? []) {
    if (migration.status === 'failed') reasons.push(\`migration:\${migration.id}:failed\`);
  }

  if (reasons.length > 0) {
    log.record({ release: candidate.release, decision: 'hold', reasons, checkedAt: candidate.checkedAt });
    return { decision: 'hold', release: candidate.release, reasons };
  }
  return { decision: 'rollout', release: candidate.release, reasons };
};

${SCRATCH_PAD}`,
        skeleton: `${RELEASE_TYPES}

const healthReasons = (probes: HealthProbe[] | null): string[] => {
  /* null or empty: one reason. Otherwise one reason per probe that is not exactly 'ready'. */
};

const configReasons = (required: string[], probes: ConfigProbe[] | null): string[] => {
  /* null: one reason. Otherwise look up each required key: missing, or a state other than 'ok'. */
};

const migrationReasons = (migrations: MigrationReport[] | null, restorePoint: string | null): string[] => {
  /* null: one reason. Otherwise status not 'applied', and, separately, not reversible without a non-blank restore point. */
};

const gateRelease = (candidate: ReleaseCandidate, log: DecisionLog): GateDecision => {
  const reasons = /* the three lists together, without duplicates, sorted */;
  const decision: Decision = /* rollout only when there is no reason */;
  /* record once, for either decision */
  return { decision, release: candidate.release, reasons };
};`,
        hints: [
          '`[].every(...)` is `true`, so the starter reads an empty probe list as healthy. Test for `null` and for length 0 before you look at a single probe.',
          'Turn `config` into a `Map` from key to probe first, then walk `requiredConfig` and look each key up. Walking the probes instead never notices a key nobody reported.',
          'Compare against the one good value (`status !== \'ready\'`, `state !== \'ok\'`, `status !== \'applied\'`) rather than listing the bad ones. A status you have never seen then holds the release, which is the safe direction.',
          '`[...new Set(list)].sort()` removes duplicates and sorts. Build the result once and pass the same reasons to `log.record` and to the return value.',
        ],
        approach: [
          'Write one function per evidence type that returns the reasons it finds, with `null` producing its own reason.',
          'Health: no probes is a reason; every probe that is not exactly `ready` is a reason naming its instance and status.',
          'Configuration: index the probes by key, then check every required key for a missing probe or a state other than `ok`, naming the key only.',
          'Migrations: a status other than `applied` is a reason; an irreversible migration without a non-blank restore point is a second, separate reason.',
          'Join the three lists, remove duplicates, sort, decide, record once, and return.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'A clean release rolls out, the result has the stated shape, and the candidate is left as it was',
            critical: true,
            weight: 3,
            detail:
              'Something outside the three evidence gates is off. Check that a candidate with ready probes, every required key `ok` and every migration applied returns `{ decision: \'rollout\', release, reasons: [] }`, that duplicate reasons appear once, that the type assertions still compile, and that the candidate is unchanged after the call.',
          },
          {
            id: 'health-gate',
            label: 'Failed, unknown or missing health evidence holds the release',
            critical: true,
            weight: 3,
            detail:
              'A release rolled out without healthy canaries. An empty or `null` probe list must hold with `health:no-probes`, and every status other than exactly `ready` (a timeout, `not_ready`, or one you have never seen) must add `health:<instance>:<status>`. This criterion is critical, so no score elsewhere can make up for it.',
          },
          {
            id: 'config-gate',
            label: 'A required key that is missing, invalid or unreported holds the release, and no value leaks',
            critical: true,
            weight: 3,
            detail:
              'The configuration gate let a release through or wrote a value down. Check every key in `requiredConfig` against the report: no probe adds `missing`, any state other than `ok` adds that state, a `null` report holds with `config:no-report`, and a key the release does not require never holds it. Reasons and the record must never contain a configuration value. This criterion is critical.',
          },
          {
            id: 'migration-gate',
            label: 'A failed, pending, unreported or unprotected migration holds the release',
            critical: true,
            weight: 3,
            detail:
              'The gate rolled out over migration evidence that should have stopped it. A status other than exactly `applied` must hold, a `null` migration report must hold with `migration:no-report`, and an irreversible migration needs a non-blank restore point. Rolling forward over a failed migration leaves a schema the old release may not run against, so this criterion is critical and cannot be averaged away.',
          },
          {
            id: 'records-why',
            label: 'Every decision is recorded once, with every reason, sorted',
            critical: true,
            weight: 2,
            detail:
              'The log does not explain the decision. Call `log.record` exactly once per call, for a rollout too, with the release, the decision, the full sorted reason list and the candidate’s `checkedAt`, and return the same reasons. A record that keeps only the first reason, or skips rollouts, leaves the next on-call engineer guessing.',
          },
        ],
        tests: [
          {
            call: '__gate({})',
            expected: {
              out: { decision: 'rollout', release: 'R-2026.10.3', reasons: [] },
              log: [CLEAN_RECORD],
            },
            label: 'a clean candidate rolls out and the rollout is recorded',
          },
          {
            call: "__gate({ health: [{ instance: 'web-1', status: 'ready' }, { instance: 'web-2', status: 'timeout' }] }).out",
            expected: { decision: 'hold', release: 'R-2026.10.3', reasons: ['health:web-2:timeout'] },
            label: 'a canary instance that timed out holds the release',
            criterion: 'health-gate',
          },
          {
            call: '__gate({ health: [] }).out',
            expected: { decision: 'hold', release: 'R-2026.10.3', reasons: ['health:no-probes'] },
            label: 'no health probes at all is not a pass',
            edge: true,
            criterion: 'health-gate',
          },
          {
            call: "__gate({ config: [{ key: 'DATABASE_URL', state: 'ok' }, { key: 'QUEUE_URL', state: 'ok' }] }).out",
            expected: { decision: 'hold', release: 'R-2026.10.3', reasons: ['config:SIGNING_KEY:missing'] },
            label: 'a required key nobody reported holds the release',
            criterion: 'config-gate',
          },
          {
            call: "(function () { var r = __gate({ config: [{ key: 'DATABASE_URL', state: 'ok', value: 'postgres://cases-db.internal.example/ops' }, { key: 'QUEUE_URL', state: 'ok', value: 'https://queue.internal.example/cases' }, { key: 'SIGNING_KEY', state: 'invalid', value: 'FIXTURE-SECRET-7731' }] }); return { reasons: r.out.reasons, leaked: JSON.stringify(r).indexOf('FIXTURE-SECRET') !== -1 }; })()",
            expected: { reasons: ['config:SIGNING_KEY:invalid'], leaked: false },
            label: 'an invalid key holds the release, and its value appears nowhere',
            criterion: 'config-gate',
          },
          {
            call: "__gate({ migrations: [{ id: '0042_add_case_priority', status: 'failed', reversible: true }] }).out",
            expected: { decision: 'hold', release: 'R-2026.10.3', reasons: ['migration:0042_add_case_priority:failed'] },
            label: 'a failed migration holds the release',
            criterion: 'migration-gate',
          },
          {
            call: "[null, 'snap-2026-10-21-0900'].map(function (point) { return __gate({ migrations: [{ id: '0043_drop_legacy_priority', status: 'applied', reversible: false }], restorePoint: point }).out.reasons; })",
            expected: [['migration:0043_drop_legacy_priority:irreversible-without-restore-point'], []],
            label: 'an irreversible migration needs a restore point, and passes with one',
            criterion: 'migration-gate',
          },
          {
            call: "__gate({ health: [{ instance: 'web-2', status: 'not_ready' }], config: [{ key: 'DATABASE_URL', state: 'ok' }, { key: 'QUEUE_URL', state: 'invalid' }, { key: 'SIGNING_KEY', state: 'ok' }], migrations: [{ id: '0042_add_case_priority', status: 'pending', reversible: true }] })",
            expected: {
              out: {
                decision: 'hold',
                release: 'R-2026.10.3',
                reasons: ['config:QUEUE_URL:invalid', 'health:web-2:not_ready', 'migration:0042_add_case_priority:pending'],
              },
              log: [{
                release: 'R-2026.10.3',
                decision: 'hold',
                reasons: ['config:QUEUE_URL:invalid', 'health:web-2:not_ready', 'migration:0042_add_case_priority:pending'],
                checkedAt: '2026-10-21T09:30:00Z',
              }],
            },
            label: 'three failures are all recorded, sorted, in one entry',
            criterion: 'records-why',
          },
        ],
        typeTests: [
          {
            code: "const __decision: 'rollout' | 'hold' = gateRelease({ release: 'R-1', checkedAt: '2026-10-21T00:00:00Z', requiredConfig: [], health: [], config: [], migrations: [], restorePoint: null }, { record: () => {} }).decision;",
            label: 'the decision is the two-value union',
          },
          {
            code: "const __shipped: 'ship' = gateRelease({ release: 'R-1', checkedAt: '2026-10-21T00:00:00Z', requiredConfig: [], health: [], config: [], migrations: [], restorePoint: null }, { record: () => {} }).decision;",
            label: 'no third decision exists',
            rejects: true,
          },
          {
            code: "const __bad = gateRelease({ release: 'R-1', checkedAt: '2026-10-21T00:00:00Z', requiredConfig: [], health: 'ok', config: [], migrations: [], restorePoint: null }, { record: () => {} });",
            label: 'health evidence is a list of probes, not a summary string',
            rejects: true,
          },
        ],
        harness: RELEASE_FIXTURES,
      },
    },
  ],
  requires: [
    { activityId: 'fde-v1-m11-deploy-checks', state: 'verified_pass' },
    { activityId: 'fde-v1-m11-deploy-release-gate', state: 'verified_pass' },
  ],
};
