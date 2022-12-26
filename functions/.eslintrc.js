module.exports = {
  root: true,
  env: {
    es6: true,
    node: true
  },
  extends: ['eslint:recommended', 'google', 'prettier', 'plugin:prettier/recommended'],
  rules: {
    'no-console': 'off',
    'no-debugger': 'off',
    'no-case-declarations': 'off'
  },
  plugins: ['@babel/plugin-proposal-optional-chaining'],
  parserOptions: {
    ecmaVersion: 8
  }
}
