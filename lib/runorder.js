// Order of the tests in the run list, matching Testmo's run view: folders in
// repository tree order, then cases inside each folder.

// Testmo's folder display_order is one number across the whole repository in
// tree (pre-order) order, so sorting by it alone keeps subfolders under their parent.
function folderKey(folders, folderId) {
  const f = folders.get(Number(folderId));
  const order = f && typeof f.display_order === 'number' ? f.display_order : Infinity;
  return [order, Number(folderId) || 0];
}

// Cases have no display order in the REST API; case id is the fallback.
function caseKey(rc) {
  const order = rc.case && typeof rc.case.display_order === 'number' ? rc.case.display_order : Infinity;
  return [order, Number(rc.caseId)];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// runCases: [{ caseId, case: { folder_id, display_order? } }]; folders: Map(folderId -> folder).
export function sortRunCases(runCases, folders) {
  return [...runCases].sort(
    (a, b) => compareKeys(folderKey(folders, a.case && a.case.folder_id), folderKey(folders, b.case && b.case.folder_id)) || compareKeys(caseKey(a), caseKey(b)),
  );
}
