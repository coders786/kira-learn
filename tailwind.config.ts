import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        kira: {
          bg: "#0a0a0f",
          surface: "#12121a",
          surfaceLight: "#1a1a28",
          border: "#2a2a3a",
          text: "#e8e8ed",
          textMuted: "#8888a0",
          accent: "#6c5ce7",
          accentLight: "#a29bfe",
          green: "#00b894",
          red: "#ff6b6b",
          yellow: "#fdcb6e",
          blue: "#74b9ff",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.6s ease-out forwards",
        "fade-up": "fadeUp 0.6s ease-out forwards",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "typing": "typing 1.5s ease-in-out infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        typing: {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "1" },
        },
        glow: {
          "0%": { boxShadow: "0 0 20px rgba(108, 92, 231, 0.1)" },
          "100%": { boxShadow: "0 0 40px rgba(108, 92, 231, 0.3)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
