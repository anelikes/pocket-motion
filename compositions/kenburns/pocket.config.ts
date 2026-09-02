import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: { push: { from: { transform: "scale(1)" }, to: { transform: "scale(1.75)" } } },
    animation: { push: "push 2000ms cubic-bezier(0.7,0,0.3,1) both" },
  },
});
