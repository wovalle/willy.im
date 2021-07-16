const { fontFamily } = require("tailwindcss/defaultTheme")

module.exports = {
  mode: "jit",
  purge: ["./src/pages/**/*.{js,ts,jsx,tsx}", "./src/components/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Lato", ...fontFamily.sans],
      },
    },
  },
}
