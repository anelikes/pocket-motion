import { Composition } from "remotion";
import { BenchTitle } from "./BenchTitle";

export const RemotionRoot: React.FC = () => (
  <Composition id="BenchTitle" component={BenchTitle} durationInFrames={300} fps={30} width={1920} height={1080} />
);
