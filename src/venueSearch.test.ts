import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { romanize, searchVenueOnline, skeleton, venueCandidates, venueQuery, VenueSearchUnavailable } from './venueSearch';
import { braveSearch } from '../server/braveSearch';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('compares Malayalam and English spellings of place and deity names', () => {
  assert.equal(romanize('കൊളച്ചേരി'), 'kolacheri');
  assert.equal(skeleton('കൊളച്ചേരി'), skeleton('Kolachery'));
  assert.equal(skeleton('വിഷകണ്ഠൻ'), skeleton('Vishakandan'));
  assert.ok(skeleton('Chathampalli').startsWith(skeleton('ചാത്തമ്പ')));
});

test('builds the search from the partial venue and the poster heading fragment', () => {
  const raw = readFileSync(new URL('./fixtures/kolacheri-puthari-ocr.txt', import.meta.url), 'utf8');
  const query = venueQuery(raw, 'വിഷകണ്ഠൻ ക്ഷേത്രം');
  assert.equal(query.malayalam, 'കൊളച്ചേരി ശ്രീ ചാത്തമ്പ വിഷകണ്ഠൻ ക്ഷേത്രം');
  assert.match(query.english, /^kolacheri sree chatthampa vishakanthan temple Kerala$/);
  assert.deepEqual(query.hints, ['കൊളച്ചേരി', 'ചാത്തമ്പ', 'വിഷകണ്ഠൻ']);
});

test('ranks the temple that matches every poster fragment first and ignores unrelated names', () => {
  const candidates = venueCandidates([
    { title: 'Kolachery Sree Chathampalli Vishakandan Temple – Theyyam', url: 'https://www.hindu-blog.com/a', description: 'The <strong>Kolachery Sree Chathampalli Vishakandan</strong> Temple is in Kannur.' },
    { title: 'Karimbam Vishakandan Temple', url: 'https://example.org/k', description: 'Near Taliparamba.' },
    { title: 'Kottiyoor Temple', url: 'https://example.org/t', description: 'A Shiva temple.' },
  ], ['കൊളച്ചേരി', 'ചാത്തമ്പ', 'വിഷകണ്ഠൻ']);
  assert.equal(candidates[0].name, 'Kolachery Sree Chathampalli Vishakandan Temple');
  assert.equal(candidates[0].source, 'hindu-blog.com');
  assert.equal(candidates[0].score, 1);
  assert.ok(candidates.every(candidate => candidate.name !== 'Kottiyoor Temple'));
  assert.ok(candidates[1].score < candidates[0].score);
});

test('reports a missing search key as unavailable rather than a failure', async () => {
  const fakeFetch = (async () => json(503, { error: 'not set up' })) as typeof fetch;
  await assert.rejects(searchVenueOnline(['q'], [], fakeFetch), VenueSearchUnavailable);
});

test('sends the key only as a server-side header and maps Brave results', async () => {
  let seen: { url: string; headers: Record<string, string> } | undefined;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    seen = { url, headers: init?.headers as Record<string, string> };
    return json(200, { web: { results: [{ title: 'A Temple', url: 'https://a.example', description: 'desc' }] } });
  }) as typeof fetch;
  const results = await braveSearch('വിഷകണ്ഠൻ ക്ഷേത്രം', 'secret', fakeFetch);
  assert.deepEqual(results, [{ title: 'A Temple', url: 'https://a.example', description: 'desc' }]);
  assert.equal(seen?.headers['X-Subscription-Token'], 'secret');
  assert.ok(!seen?.url.includes('secret'));
  assert.match(seen?.url || '', /q=%E0%B4%B5/);
  const rejected = (async () => json(401, {})) as typeof fetch;
  await assert.rejects(braveSearch('x', 'bad', rejected), /key was rejected/);
});
