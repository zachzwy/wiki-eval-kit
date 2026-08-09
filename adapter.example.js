// THE ONLY FILE YOU IMPLEMENT.
//
// Copy to `adapter.js` and wire the two functions to your system. Everything
// else in this kit is generic and needs no changes.
//
// Nothing here should be committed with real content in it — the adapter should
// call your system, not embed data from it.

/**
 * STAGE 0 (corpus health) — list the pages currently in the wiki.
 *
 * @returns {Promise<Array<{
 *   id: string,          // stable page id
 *   title?: string,
 *   text: string,        // full page text
 *   updatedAt?: string,  // ISO date of the newest source behind this page
 *   sourceCount?: number // how many sources were merged into it (if known)
 * }>>}
 */
export async function listPages() {
  // Examples:
  //   read a directory of markdown files
  //   query your wiki's API / DB
  //   read the ingest pipeline's output snapshot
  throw new Error("implement listPages()");
}

/**
 * STAGES 2–3 (answer quality) — ask the system a question, return the final
 * answer text a user would see.
 *
 * `condition` lets you A/B ingest configurations without changing the eval:
 * e.g. "reconcile-on" vs "reconcile-off", or "wiki" vs "raw-sources".
 * Ignore it if you only have one configuration.
 *
 * @param {string} question
 * @param {{condition?: string}} opts
 * @returns {Promise<string>} the answer text
 */
export async function ask(question, { condition } = {}) {
  throw new Error("implement ask()");
}

/**
 * OPTIONAL — an LLM judge, for questions regex cannot grade.
 * Only needed once you add questions with a `rubric` (see questions.example.json).
 * Return true if the answer satisfies the rubric.
 *
 * @param {{question: string, answer: string, rubric: string}} args
 * @returns {Promise<boolean>}
 */
export async function judge({ question, answer, rubric }) {
  throw new Error("implement judge() — only needed for rubric-graded questions");
}
