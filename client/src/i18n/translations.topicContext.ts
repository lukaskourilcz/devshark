// Shared learning context for the map and Daily. This names each subject area;
// the question's already-public introduction supplies its specific concept.
// Keep answers, explanations and raw authoring tags out of this context.
export const topicContext: Readonly<Record<string, string>> = {
  html: 'HTML gives a web page its structure and meaning. Explore elements, forms and document semantics, including how assistive technology reads them.',
  css: 'CSS controls the presentation of web documents. Explore layout, the cascade and responsive styling as the available space and content change.',
  javascript: 'JavaScript describes the behaviour of web applications. Explore values, functions, objects and asynchronous work, then follow how the code runs.',
  typescript: 'TypeScript adds static type checking to JavaScript. Explore how types describe values and relationships, and what the compiler can check before the code runs.',
  react: 'React builds interfaces from components. Explore how props, state and rendering work together, and how components connect to systems outside React.',
  nextjs: 'Next.js builds on React with routing and server capabilities. Explore where code runs, how data reaches a page and how rendering and caching affect an application.',
  nodejs: 'Node.js runs JavaScript outside the browser. Explore server-side requests, asynchronous I/O and modules, including how errors and resources are handled.',
  git: 'Git records changes to a project over time. Explore commits, branches and collaboration, including how to inspect history and recover from mistakes.',
  databases: 'Databases organize and retrieve persistent data. Explore data models, queries and transactions, and how indexes and constraints affect reliability.',
  'system-design': 'System design connects components into a working service. Explore storage, communication and scaling, weighing the reliability and operational cost of each choice.',
  testing: 'Testing checks software behaviour against expectations. Explore unit, integration and end-to-end tests, and how useful checks catch failures without depending on incidental details.',
  devops: 'DevOps connects software delivery with operating a service. Explore build pipelines, deployments and infrastructure, including how to observe and recover a running system.',
  security: 'Application security protects data and access across trust boundaries. Explore authentication, authorization and common vulnerabilities, including how defensive checks can fail.',
  ai: 'AI and language models turn learned patterns into predictions and generated output. Explore model behaviour, retrieval and evaluation, including the limits of what an output tells you.',
  dsa: 'Data structures organize information so an algorithm can use it. Explore arrays, maps, trees and other structures, comparing the work and memory their operations require.',
  'dsa-advanced': 'Advanced data structures support more demanding queries and updates. Explore their invariants and trade-offs, and reason about the cost of maintaining them.',
  algorithms: 'Algorithms describe a sequence of steps for solving a problem. Explore search, ordering and problem-solving strategies, then reason about correctness and complexity.',
  abbreviations: 'Technical abbreviations condense terms used across software development. Explore what they mean and the context in which developers use them.',
  general: 'Software development combines programming with tools and engineering practices. Explore the concepts that connect everyday implementation decisions to a working application.',
  'dev-world': 'Software is built within a wider ecosystem of tools, standards and teams. Explore the terminology and practices developers encounter beyond a single language.',
  'code-snippets': 'Reading a short program means tracking values and control flow. Explore what each expression and operation does before predicting the result.',
  'cool-stuff': 'Explore the broader world around technology and computing through short practice questions.',
};
