import { mount } from "@pocketjs/framework";
import { Image, Text, View } from "@pocketjs/framework/components";

/**
 * The fixture for `images.missingFile`: one picture that is not there.
 *
 * `wordmark.png` is in this directory in no version of this repository, and
 * that is the whole composition. Upstream's build discovers the name off this
 * string literal, finds nothing in any of the three places it looks, logs one
 * line, bakes a 32×32 checkerboard and SUCCEEDS — so the pak is valid, the
 * realm is clean, and the frame digest is stable and reproducible with a
 * checkerboard where the mark should be. `lint` and `check` are what refuse
 * it (`src/lint/images.ts`); nothing else in the pipeline does.
 *
 * The Text is here so the refusal is not the only thing in the file: a
 * composition can be otherwise correct and still lose its picture.
 */
mount(() => (
  <View class="w-full h-full bg-zinc-950 items-center justify-center gap-10">
    <Image class="w-[256] h-[128]" src="wordmark.png" />
    <Text class="text-[48px] font-bold text-zinc-50">{"MARK ABOVE"}</Text>
  </View>
));
