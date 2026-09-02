import { Composition } from "remotion";
import { Smoke } from "./Smoke";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Smoke"
    component={Smoke}
    durationInFrames={450}
    fps={30}
    width={1920}
    height={1080}
  />
);
