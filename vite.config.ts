import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const publicEnv = loadEnv(mode, process.cwd(), "VITE_");
  const supabaseUrl = publicEnv.VITE_SUPABASE_URL || "http://127.0.0.1:54321";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/api/v1": {
          target: supabaseUrl,
          changeOrigin: true,
          rewrite: (requestPath) =>
            `/functions/v1/api-v1${requestPath.slice("/api/v1".length)}`,
        },
      },
    },
    plugins: [react()],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "vendor",
                test: /node_modules[\\/]/,
                maxSize: 400_000,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  };
});
