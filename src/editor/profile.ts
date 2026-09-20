// Необязательные замеры участков редактора для проверок из qa/.
//
// Пока никто не поставил приёмник в globalThis.__marknoteProfile__, обёртка
// просто вызывает переданную работу: в обычной работе редактора она ничего не
// считает и ничего не выделяет. Приёмник ставит скрипт замера через CDP, и
// тогда в него попадает длительность каждого участка. Держим это в коде
// нарочно: иначе каждый следующий замер начинается с правки исходников, а
// правка исходников ради замера — это уже другой предмет измерения.

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
