// Optional timings for editor sections used by qa/ checks.
//
// Until a sink is installed in globalThis.__marknoteProfile__, the wrapper only
// calls the supplied operation: normal editor work performs no timing and no
// allocations. A CDP benchmark installs the sink and receives each section's
// duration. This intentionally stays in the code; otherwise every new benchmark
// would begin by changing the source, and source changes made for measurement
// would become a different thing being measured.

type ProfileEntry = { name: string; duration: number };

type ProfileSink = { entries: ProfileEntry[] };

function profileSink(): ProfileSink | null {
  const global = globalThis as typeof globalThis & { __marknoteProfile__?: ProfileSink };
  const sink = global.__marknoteProfile__;
  return sink && Array.isArray(sink.entries) ? sink : null;
}

export function profileMeasure<T>(name: string, operation: () => T): T {
  const sink = profileSink();
  if (!sink) return operation();
  const started = performance.now();
  try {
    return operation();
  } finally {
    sink.entries.push({ name, duration: performance.now() - started });
  }
}
