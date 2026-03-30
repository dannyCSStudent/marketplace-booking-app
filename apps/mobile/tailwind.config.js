/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
    "../../packages/*/src/**/*.{js,jsx,ts,tsx}", // only direct packages
  ],  
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
}