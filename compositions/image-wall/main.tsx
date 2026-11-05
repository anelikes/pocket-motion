// @title PocketJS Motion — an image wall pushed in
//
// The fixture for `image-filter-trilinear` (patches/0058): every cover is
// drawn at 15% of its size and the wall is pushed in to 26% over ten seconds,
// so each cover is read from levels 2 and 3 of its mip chain at the first
// frame and levels 1 and 2 at the last. `baselines/image-wall.md` measures
// the same wall without the class.
import { mount } from "@pocketjs/framework";
import Wall from "./app.tsx";

mount(() => <Wall />);
