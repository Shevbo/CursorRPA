import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        shectory: { bg: "#0f1419", card: "#1a2332", accent: "#3b82f6" },
      },
    },
  },
  plugins: [],
};
export default config;
