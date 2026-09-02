// @title PocketJS Motion — malicious fixture (must be REJECTED)
// Acceptance fixture for Phase 0 criterion 1. Every line here is a
// determinism violation the harness must refuse.
import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

const stamp = Date.now();                    // wall clock
const roll = Math.random();                  // unseeded randomness
const pretty = (1234.5).toLocaleString();    // ICU / locale

export default function Malicious() {
  return (
    <View class="w-full h-full bg-slate-950 p-4">
      <Text class="text-base text-slate-50">{`${stamp} ${roll} ${pretty}`}</Text>
    </View>
  );
}

mount(() => <Malicious />);
