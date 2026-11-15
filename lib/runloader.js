// Loads everything the panel needs for one run: the case content, the latest
// result per test, and the run-test id for every case (needed to post results).

// Resolve run_tests.id for each case. Sources, in order of trust:
//   1. latest results from the REST API (exact),
//   2. the run page's test search via the user's web session (exact),
// Anything still unresolved is reported so the UI can explain what to do.
export async function resolveTestIds({ api, session, runId, caseIds, onProgress }) {
  const byCase = new Map();
  const latest = await api.getLatestRunResults(runId);
  for (const r of latest) {
    byCase.set(Number(r.case_id), { testId: Number(r.test_id), latest: r });
  }
  const missing = caseIds.map(Number).filter((id) => !byCase.has(id));
  const unresolved = [];
  let sessionUsed = false;
  let sessionLoggedIn = session ? session.loggedIn : null;
  if (missing.length && session) {
    const ok = session.loggedIn ?? (await session.probe(runId));
    sessionLoggedIn = ok;
    if (ok) {
      sessionUsed = true;
      let done = 0;
      const queue = [...missing];
      const worker = async () => {
        while (queue.length) {
          const caseId = queue.shift();
          try {
            const testId = await session.findTestId(runId, caseId);
            if (testId) byCase.set(caseId, { testId, latest: null });
            else unresolved.push(caseId);
          } catch {
            unresolved.push(caseId);
          }
          done += 1;
          if (onProgress) onProgress(done, missing.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    } else {
      unresolved.push(...missing);
    }
  } else {
    unresolved.push(...missing);
  }
  return { byCase, unresolved, sessionUsed, sessionLoggedIn };
}

// Fetch repository case content for the run's cases. The cases endpoint has no
// id filter, so we page newest-first and, whenever we discover a folder that
// holds one of our cases, pull that folder in one go (runs usually come from a
// few folders). Previously fetched cases are served from the cache.
export async function loadCases({ api, projectId, caseIds, cache, onProgress }) {
  const wanted = new Set(caseIds.map(Number));
  const found = new Map();
  for (const id of wanted) {
    const cached = cache && cache.get(id);
    if (cached) found.set(id, cached);
  }
  if (found.size === wanted.size) return found;

  const seenFolders = new Set();
  const fetchedFolders = new Set();
  const minWanted = Math.min(...[...wanted].filter((id) => !found.has(id)));
  let page = 1;
  for (;;) {
    const data = await api.request('GET', `/projects/${projectId}/cases`, {
      query: { page, per_page: 100, sort: 'repository_cases:id', order: 'desc' },
    });
    const rows = data.result || [];
    let pageMin = Infinity;
    for (const c of rows) {
      const id = Number(c.id);
      pageMin = Math.min(pageMin, id);
      if (wanted.has(id) && !found.has(id)) {
        found.set(id, c);
        if (c.folder_id && !seenFolders.has(c.folder_id)) seenFolders.add(c.folder_id);
      }
    }
    // Pull whole folders we just learned about; most of the run is usually there.
    for (const folderId of [...seenFolders]) {
      if (fetchedFolders.has(folderId)) continue;
      fetchedFolders.add(folderId);
      const folderCases = await api.getAllPages(`/projects/${projectId}/cases`, { folder_id: folderId });
      for (const c of folderCases) {
        const id = Number(c.id);
        if (wanted.has(id)) found.set(id, c);
      }
    }
    if (onProgress) onProgress(found.size, wanted.size);
    if (found.size >= wanted.size) break;
    if (!rows.length || pageMin <= minWanted) break;
    if (!data.next_page) break;
    page += 1;
    if (page > 500) break;
  }
  if (cache) for (const [id, c] of found) cache.set(id, c);
  return found;
}

// Describe a case's template fields in display order, using the project's
// field definitions so custom fields are labelled the way Testmo labels them.
export function describeFields(caseObj, templates, fields) {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const bySystem = new Map(fields.map((f) => [f.system_name, f]));
  const template = templates.find((t) => Number(t.id) === Number(caseObj.template_id));
  const ordered = [];
  const used = new Set();
  const templateFields = (template && template.fields) || [];
  for (const tf of templateFields) {
    const def = byName.get(tf.name) || bySystem.get(tf.system_name) || (typeof tf === 'string' ? byName.get(tf) : null);
    if (def) {
      ordered.push(def);
      used.add(def.column_name);
    }
  }
  // Include any populated custom field the template did not list.
  for (const f of fields) {
    if (used.has(f.column_name)) continue;
    const v = caseObj[f.column_name];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) ordered.push(f);
  }
  return ordered
    .map((f) => ({ name: f.name, type: f.type, column: f.column_name, value: caseObj[f.column_name] }))
    .filter((f) => f.value !== undefined && f.value !== null && f.value !== '' && !(Array.isArray(f.value) && !f.value.length));
}

// Which of these runs have tests assigned to the current user. Prefers the
// signed-in web session (complete), falls back to REST results (only tests that
// already have a result carry an assignee).
export async function runsAssignedToMe({ api, session, runs, userId }) {
  if (session) {
    const ok = session.loggedIn ?? (await session.probe(null));
    if (ok) {
      try {
        const map = await session.assignedRunIds();
        return { ids: new Set([...map.keys()]), counts: map, source: 'session' };
      } catch {
        // fall through to the REST approximation
      }
    }
  }
  const ids = new Set();
  const counts = new Map();
  const queue = [...runs];
  const worker = async () => {
    while (queue.length) {
      const run = queue.shift();
      try {
        const results = await api.getResultsAssignedTo(run.id, userId);
        if (results.length) {
          ids.add(Number(run.id));
          counts.set(Number(run.id), results.length);
        }
      } catch {
        // ignore this run
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { ids, counts, source: 'api' };
}

// Pick the milestone to show by default: the newest one that is not completed.
export function defaultMilestoneId(milestones) {
  const open = milestones.filter((m) => !m.is_completed);
  if (!open.length) return 'all';
  open.sort((a, b) => {
    const da = a.start_date || a.created_at || '';
    const db = b.start_date || b.created_at || '';
    if (da !== db) return da < db ? 1 : -1;
    return Number(b.id) - Number(a.id);
  });
  return Number(open[0].id);
}
