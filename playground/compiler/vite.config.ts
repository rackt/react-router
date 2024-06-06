import { vitePlugin as reactRouter } from "@react-router/dev";
import { installGlobals } from "@react-router/node";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals();

export default defineConfig({
  plugins: [
    reactRouter({
      future: {
        unstable_serverComponents: true,
      },
    }),
    tsconfigPaths(),
  ],
});
