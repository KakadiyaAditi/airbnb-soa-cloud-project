import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [usersArg, durationArg, label] = process.argv.slice(2);
const users = Number(usersArg);
const duration = Number(durationArg);
const base = "https://gv1cw6q1p2.execute-api.ap-south-1.amazonaws.com/dev";

if (!Number.isInteger(users) || users < 1 || !Number.isInteger(duration) || duration < 1 || !label) {
  console.error("Usage: node serverless-load-test.mjs <users> <seconds> <label>");
  process.exit(1);
}

const paths = ["/api/health", "/api/listings"];
const samples = [];
const deadline = Date.now() + duration * 1000;

console.log(`Starting ${label}: ${users} users for ${duration} seconds`);
console.log(`Target: ${base}`);

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function worker(workerId) {
  let sequence = workerId;

  while (Date.now() < deadline) {
    const path = paths[sequence % paths.length];
    sequence++;

    const started = performance.now();
    let status = 0;
    let success = false;
    let error = "";

    try {
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(15000)
      });
      await response.text();
      status = response.status;
      success = response.ok;
      if (!success) error = `HTTP ${status}`;
    } catch (e) {
      error = e.message || String(e);
    }

    samples.push({
      endpoint: path,
      status,
      success,
      latency_ms: Number((performance.now() - started).toFixed(2)),
      error
    });

    await pause(500);
  }
}

await Promise.all(Array.from({ length: users }, (_, i) => worker(i)));

const latencies = samples.map(x => x.latency_ms).sort((a, b) => a - b);
const total = samples.length;
const failed = samples.filter(x => !x.success).length;
const percentile = p => latencies.length
  ? latencies[Math.min(Math.ceil(p * latencies.length) - 1, latencies.length - 1)]
  : 0;
const average = latencies.length
  ? latencies.reduce((a, b) => a + b, 0) / latencies.length
  : 0;

const summary = {
  test: label,
  concurrency: users,
  duration_seconds: duration,
  total_requests: total,
  successful_requests: total - failed,
  failed_requests: failed,
  failure_percent: total ? Number((failed / total * 100).toFixed(2)) : 0,
  throughput_requests_per_second: Number((total / duration).toFixed(2)),
  average_response_ms: Number(average.toFixed(2)),
  median_response_ms: Number(percentile(0.50).toFixed(2)),
  p95_response_ms: Number(percentile(0.95).toFixed(2)),
  p99_response_ms: Number(percentile(0.99).toFixed(2)),
  min_response_ms: latencies.length ? latencies[0] : 0,
  max_response_ms: latencies.length ? latencies[latencies.length - 1] : 0,
  endpoints: paths.map(path => {
    const rows = samples.filter(x => x.endpoint === path);
    return {
      endpoint: path,
      requests: rows.length,
      failures: rows.filter(x => !x.success).length
    };
  })
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const prefix = `load-testing/serverless-${label}-${stamp}`;

writeFileSync(`${prefix}-summary.json`, JSON.stringify(summary, null, 2));
const csv = [
  "endpoint,status,success,latency_ms,error",
  ...samples.map(x =>
    [x.endpoint, x.status, x.success, x.latency_ms, `"${x.error.replaceAll('"', '""')}"`].join(",")
  )
].join("\n");
writeFileSync(`${prefix}-requests.csv`, csv);

console.log("\n===== TEST SUMMARY =====");
console.log(JSON.stringify(summary, null, 2));
console.log(`\nSaved: ${prefix}-summary.json`);
console.log(`Saved: ${prefix}-requests.csv`);
