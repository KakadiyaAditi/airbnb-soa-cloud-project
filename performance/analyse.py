"""Summarise real k6 NDJSON; never manufacture cloud CPU/instance metrics."""
import argparse, csv, json, math, statistics
from pathlib import Path
from datetime import datetime
from collections import defaultdict

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw', required=True)
    parser.add_argument('--summary', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--cpu')
    parser.add_argument('--cloud', help='Actual CSV exported by collect-evidence.ps1; never simulated observations')
    args = parser.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    buckets = defaultdict(lambda: {'durations': [], 'requests': 0, 'failed': 0, 'conflicts': 0, 'dropped': 0, 'start': float('inf'), 'end': 0})
    with open(args.raw, encoding='utf-8-sig') as stream:
        for line in stream:
            event = json.loads(line)
            if event.get('type') != 'Point': continue
            point = event['data']; phase = point.get('tags', {}).get('phase') or point.get('tags', {}).get('scenario', 'setup_or_teardown')
            row = buckets[phase]; value = point['value']; metric = event['metric']
            if metric == 'http_req_duration':
                row['durations'].append(value)
                stamp = datetime.fromisoformat(point['time'].replace('Z', '+00:00')).timestamp()
                row['start'] = min(row['start'], stamp - value / 1000)
                row['end'] = max(row['end'], stamp)
            elif metric == 'http_reqs': row['requests'] += value
            elif metric == 'http_req_failed': row['failed'] += value
            elif metric == 'booking_conflicts': row['conflicts'] += value
            elif metric == 'dropped_iterations': row['dropped'] += value
    rows = []
    for phase in ['normal', 'weekend', 'holiday', 'extreme', 'recovery', 'setup_or_teardown']:
        if phase not in buckets: continue
        bucket = buckets[phase]; samples = sorted(bucket['durations'])
        elapsed = bucket['end'] - bucket['start']
        rank = lambda p: samples[max(0, math.ceil(len(samples) * p) - 1)] if samples else None
        rows.append(dict(phase=phase, requests=bucket['requests'], observed_window_seconds=round(elapsed, 3) if elapsed > 0 else None,
                         requests_per_second=round(bucket['requests'] / elapsed, 3) if elapsed > 0 else None,
                         average_ms=round(statistics.mean(samples), 3) if samples else None,
                         median_ms=round(statistics.median(samples), 3) if samples else None,
                         p95_ms=round(rank(.95), 3) if samples else None, p99_ms=round(rank(.99), 3) if samples else None,
                         failed_requests=bucket['failed'], error_rate=bucket['failed']/bucket['requests'] if bucket['requests'] else None,
                         expected_booking_conflicts=bucket['conflicts'], dropped_iterations=bucket['dropped'],
                         aws_cpu_utilization='NOT_MEASURED', aws_running_instances='NOT_MEASURED'))
    if not rows: raise SystemExit('No k6 point observations found; refusing to generate a performance report.')
    with open(out/'performance.csv', 'w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)
    metadata = json.loads(Path(args.summary).read_text(encoding='utf-8-sig'))
    (out/'analysis.json').write_text(json.dumps({'source':'actual-k6-ndjson','summary':metadata,'phases':rows}, indent=2), encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plotted = [row for row in rows if row['phase'] != 'setup_or_teardown' and row['p95_ms'] is not None]
    figure, axes = plt.subplots(1, 2, figsize=(12, 4))
    for percentile in ['p95_ms', 'p99_ms']:
        axes[0].plot([row['phase'] for row in plotted], [row[percentile] for row in plotted], marker='o', label=percentile)
    axes[0].set_ylabel('Client request latency (ms)'); axes[0].legend(); axes[0].grid(alpha=.2)
    axes[1].bar([row['phase'] for row in plotted], [row['requests_per_second'] for row in plotted])
    axes[1].set_ylabel('Observed completed HTTP requests / second')
    figure.suptitle('Measured workload — see metadata for target and conditions')
    figure.tight_layout(); figure.savefig(out/'latency-throughput.png', dpi=180); plt.close(figure)
    if args.cpu and Path(args.cpu).exists():
        cpu = defaultdict(list)
        for line in Path(args.cpu).read_text(encoding='utf-8-sig').splitlines():
            sample = json.loads(line)
            cpu[sample['Name']].append((sample['observedAt'], float(sample['CPUPerc'].rstrip('%'))))
        if cpu:
            figure, axis = plt.subplots(figsize=(10, 4))
            for name, samples in cpu.items():
                axis.plot([datetime.fromisoformat(s[0].replace('Z','+00:00')) for s in samples], [s[1] for s in samples], label=name)
            axis.set_ylabel('Docker container CPU % (100% = one core)')
            axis.set_title('Actual local Docker samples — not AWS CPU/scaling evidence'); axis.legend(fontsize=7)
            figure.autofmt_xdate(); figure.tight_layout(); figure.savefig(out/'local-container-cpu.png', dpi=180); plt.close(figure)
    if args.cloud:
        cloud = defaultdict(list)
        with open(args.cloud, encoding='utf-8-sig') as stream:
            for row in csv.DictReader(stream):
                if row.get('source') != 'ACTUAL_AWS_CLOUDWATCH':
                    raise SystemExit('Refusing to label unverified/simulated rows as AWS observations.')
                cloud[row['metric']].append((datetime.fromisoformat(row['timestampUtc'].replace('Z','+00:00')), float(row['value'])))
        if not cloud: raise SystemExit('No actual cloud observations to plot.')
        figure, axes = plt.subplots(3, 1, figsize=(10, 9))
        for axis, metrics, ylabel in [(axes[0], ['cpu'], 'EC2 CPU %'), (axes[1], ['instances'], 'In-service instances (minute avg)'), (axes[2], ['p95','p99'], 'ALB target latency (seconds)')]:
            for metric in metrics:
                points = sorted(cloud.get(metric, []))
                if points: axis.plot([p[0] for p in points], [p[1] for p in points], marker='.', label=metric)
            axis.set_ylabel(ylabel); axis.grid(alpha=.2)
            if axis.lines: axis.legend()
        figure.suptitle('Actual AWS CloudWatch observations — missing data is not zero-filled')
        figure.autofmt_xdate(); figure.tight_layout(); figure.savefig(out/'aws-monitoring.png', dpi=180); plt.close(figure)
    print(json.dumps(rows, indent=2))

if __name__ == '__main__': main()
