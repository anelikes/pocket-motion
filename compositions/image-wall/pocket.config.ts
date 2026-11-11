import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: { push: { from: { transform: "scale(1)" }, to: { transform: "scale(1.75)" } } },
    animation: { push: "push 10000ms linear both" },
  },
});
