// Negative fixture: a composition that is NOT mount-only and that `check`
// passed with a green light until 2026-08-13.
//
// It walked through two independent holes:
//
//   1. The runtime oracle counts guest ops over a window. This composition
//      issues none — the timer's deadline is frame 600, twenty seconds away.
//      Lengthening the window does not fix the class: the deadline is a free
//      parameter, so for any window there is a timer that outlasts it.
//
//   2. The static lint rejects `after`, but `check` read `main.tsx` and nothing
//      else — and an entry is usually four lines that render a component from
//      somewhere else, so the one file it read was the one file that could not
//      hold the violation.
//
// Both are closed now, and the fixture's job is to keep them closed
// INDEPENDENTLY. `pendingWork()` asks the framework what it is still holding,
// and a booked timer is one whether or not anything has observed it yet;
// `check` lints every source in the composition, so the import is found where
// it actually is.
//
// Expected: `check` exits 1, reporting BOTH `timers=1` and a
// `mountOnly.forbiddenImport` in this file. Either alone is enough; the point
// is that neither is load-bearing for the other.
//
// (Writing this comment is also what exposed a third bug: prose containing the
// word "import" above a real import used to make the lint's parser skip that
// statement. tests/mount-only.test.ts covers it.)

import { after } from "@pocketjs/framework/clock";
import { Text, View } from "@pocketjs/framework/components";
import { createSignal } from "solid-js";

export default function LateTimer() {
  const [late, setLate] = createSignal(false);

  // 20 s at 30 fps — frame 600, long past any window `check` would observe.
  after(20, () => setLate(true));

  return (
    <View class="w-full h-full flex-col items-center justify-center bg-zinc-950 gap-4">
      <Text class="text-4xl font-bold text-zinc-50">late timer</Text>
      <Text class="text-lg text-zinc-400">
        {late() ? "fired — the world changed on frame 600" : "nothing has happened yet"}
      </Text>
    </View>
  );
}
