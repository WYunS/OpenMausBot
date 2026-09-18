export async function api(route, { method = 'GET', body } = {}) {
  if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Invalid API route');
  const response = await fetch(`https://api.github.com${route}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) { const error = new Error(`GitHub ${method} ${route}: ${response.status} ${data?.message}`); error.status = response.status; throw error; }
  return data;
}
export async function absent(route) {
  try { await api(route); } catch (e) { if (e.status === 404) return; throw e; }
  throw new Error(`Version already exists: ${route}. Use a new version; existing assets are never overwritten.`);
}

// A pre-created source tag is reusable only for exactly the checked-out commit.
// Published releases are still checked separately and are never overwritten.
export async function matchingSourceTag(base, tag, sourceSha) {
  let ref;
  try { ref = await api(`${base}/git/ref/tags/${encodeURIComponent(tag)}`); }
  catch (error) { if (error.status === 404) return false; throw error; }
  let object = ref.object;
  const seen = new Set();
  while (object?.type === 'tag') {
    if (seen.has(object.sha) || seen.size >= 8) throw new Error('Invalid nested source tag');
    seen.add(object.sha);
    object = (await api(`${base}/git/tags/${object.sha}`)).object;
  }
  if (object?.type !== 'commit' || object.sha !== sourceSha) {
    throw new Error(`Source tag ${tag} points to another commit; select that tag as source_ref or use a new version.`);
  }
  return true;
}
