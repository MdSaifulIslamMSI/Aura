/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Neo-Glassmorphic brand colors
        neo: {
          bg: "#09090b", // zinc-950
          glass: "rgba(255, 255, 255, 0.05)",
          "glass-border": "rgba(255, 255, 255, 0.1)",
          "glass-hover": "rgba(255, 255, 255, 0.1)",
          fuchsia: "#d946ef",
          cyan: "#06b6d4",
          violet: "#8b5cf6",
          emerald: "#10b981",
          rose: "#f43f5e",
          gray: "#27272a",
          "gray-light": "#a1a1aa",
          muted: "#18181b",
        },
        // Legacy flipkart aliases mapping to new dark theme
        flipkart: {
          blue: "#06b6d4", // mapped to cyan
          "blue-dark": "#0891b2",
          yellow: "#eab308",
          green: "#10b981", // emerald
          orange: "#f97316",
          red: "#f43f5e",
          gray: "#09090b", // background
          "gray-dark": "#a1a1aa",
          black: "#f8fafc", // white
          white: "#09090b", // black wrapper
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 8px)",
        lg: "calc(var(--radius) + 4px)",
        md: "calc(var(--radius))",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        "glass": "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        "neon-fuchsia": "0 0 10px rgba(217, 70, 239, 0.5), 0 0 20px rgba(217, 70, 239, 0.3)",
        "neon-cyan": "0 0 10px rgba(6, 182, 212, 0.5), 0 0 20px rgba(6, 182, 212, 0.3)",
        "neon-violet": "0 0 10px rgba(139, 92, 246, 0.5), 0 0 20px rgba(139, 92, 246, 0.3)",
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "float": "float 6s ease-in-out infinite",
        "pulse-glow": "pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fade-in 0.5s ease-out forwards",
        "fade-up": "fade-up 0.5s ease-out forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
