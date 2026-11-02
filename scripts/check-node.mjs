// Runs before `yarn dev` / `yarn start`. On older Node the API hangs silently instead of
// failing (a dependency needs newer Node), so stop early with a clear message.
const REQUIRED_MAJOR = 22
const major = Number(process.versions.node.split('.')[0])

if (major < REQUIRED_MAJOR) {
  console.error(
    `\nAlárinà API needs Node ${REQUIRED_MAJOR} or newer, but this is Node ${process.versions.node}.` +
      `\nRun \`nvm use\` in this folder (it reads .nvmrc), then start again.\n`,
  )
  process.exit(1)
}
