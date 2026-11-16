import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate } from 'k6/metrics';

const get = (url, params = {}) => http.get(url, { timeout: '15s', ...params });
const post = (url, body, params = {}) => http.post(url, body, { timeout: '15s', ...params });
const patch = (url, body, params = {}) => http.patch(url, body, { timeout: '15s', ...params });
const base = (__ENV.BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base) && __ENV.CONFIRM_OWNED_TARGET !== 'true')
  throw new Error('Remote load tests require explicit CONFIRM_OWNED_TARGET=true and approval for your own deployment.');
const fixture = JSON.parse(open(__ENV.FIXTURE || './fixtures.local.json'));
const seconds = Number(__ENV.PHASE_SECONDS || 60);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600) throw new Error('PHASE_SECONDS must be 10–600');
const rates = [Number(__ENV.NORMAL_RATE || 5), Number(__ENV.WEEKEND_RATE || 10), Number(__ENV.HOLIDAY_RATE || 20), Number(__ENV.EXTREME_RATE || 40), Number(__ENV.NORMAL_RATE || 5)];
if (rates.some(rate => !Number.isInteger(rate) || rate < 1 || rate > 200)) throw new Error('Use approved rates of 1–200 iterations/second');
const phases = ['normal', 'weekend', 'holiday', 'extreme', 'recovery'];
const scenarios = {};
for (let i = 0; i < phases.length; i++) {
  scenarios[phases[i]] = {
    executor: 'ramping-arrival-rate', startRate: i ? rates[i-1] : rates[0], timeUnit: '1s',
    preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 10), maxVUs: Number(__ENV.MAX_VUS || 50),
    startTime: `${i * seconds}s`, stages: [{ duration: `${Math.min(10, Math.floor(seconds/2))}s`, target: rates[i] }, { duration: `${seconds - Math.min(10, Math.floor(seconds/2))}s`, target: rates[i] }],
    gracefulStop: '5s', tags: { phase: phases[i] },
  };
}
export const options = {
  scenarios, discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1500', 'p(99)<3000'], dropped_iterations: ['count==0'], checks: ['rate>0.99'], booking_unexpected_failure: ['rate<0.01'] },
};
const conflicts = new Counter('booking_conflicts');
const failure = new Rate('booking_unexpected_failure');
function json(response) { try { return response.json(); } catch { return {}; } }
function tags(route) { return { route, name: route }; }
export function setup() {
  if (!fixture.runId || fixture.contract !== 1 || !fixture.bookingIds?.length) fail('Prepare isolated load-test fixtures first.');
  const response = get(`${base}/health`, { tags: tags('health') });
  const health = json(response);
  if (response.status !== 200 || !health.data?.loadTestingAllowed || !health.data?.bookingIdempotency || !health.data?.bookingTransactions)
    fail('Target is not explicitly enabled for isolated load testing with transaction/idempotency support.');
  return { runId: fixture.runId };
}
export default function (data) {
  const iteration = exec.scenario.iterationInTest;
  const id = fixture.bookingIds[exec.vu.idInTest % fixture.bookingIds.length];
  const choice = iteration % 10;
  if (choice < 4) {
    const response = get(`${base}/api/listings?limit=10`, { tags: tags('listing') });
    check(response, { 'listing success': r => r.status === 200 && json(r).success });
  } else if (choice < 8) {
    const response = get(`${base}/api/search?location=London&guests=2&sort=price_asc`, { tags: tags('search') });
    check(response, { 'search success': r => r.status === 200 && json(r).success });
  } else {
    const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const checkIn = day(5 + exec.vu.idInTest % 20 * 3), checkOut = day(7 + exec.vu.idInTest % 20 * 3);
    if (choice === 8) {
      const response = get(`${base}/api/availability?listingId=${id}&checkIn=${checkIn}&checkOut=${checkOut}`, { tags: tags('availability') });
      check(response, { 'availability success': r => r.status === 200 && typeof json(r).data?.available === 'boolean' });
      return;
    }
    const key = `${data.runId}-${exec.scenario.name}-${exec.vu.idInTest}-${iteration}`;
    const body = JSON.stringify({ listingId: id, guestName: 'Synthetic load guest', guestEmail: 'load@example.invalid', numberOfGuests: 1, checkInDate: checkIn, checkOutDate: checkOut });
    const params = { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, tags: tags('booking'), responseCallback: http.expectedStatuses(201, 409) };
    const response = post(`${base}/api/bookings`, body, params);
    const result = json(response);
    if (response.status === 409 && result.error?.code === 'BOOKING_CONFLICT') { conflicts.add(1); failure.add(false); return; }
    const created = response.status === 201 && !!result.data?._id;
    failure.add(!created); check(response, { 'booking created': () => created });
    if (!created) return;
    const replay = post(`${base}/api/bookings`, body, { ...params, tags: tags('booking_replay') });
    check(replay, { 'idempotent replay matches': r => r.status === 201 && json(r).data?._id === result.data._id });
    const cancel = patch(`${base}/api/bookings/${result.data._id}/status`, JSON.stringify({ bookingStatus: 'Cancelled' }), { headers: { 'Content-Type': 'application/json' }, tags: tags('cancellation') });
    check(cancel, { 'cancellation success': r => r.status === 200 && json(r).data?.bookingStatus === 'Cancelled' });
  }
}
export function handleSummary(data) {
  return { [__ENV.SUMMARY_FILE || 'summary.json']: JSON.stringify({ provenance: 'actual-k6-client-observations', target: base, measuredAt: new Date().toISOString(), phaseSeconds: seconds, requestedRates: Object.fromEntries(phases.map((p,i)=>[p,rates[i]])), fixtureRun: fixture.runId, ...data }, null, 2) };
}
