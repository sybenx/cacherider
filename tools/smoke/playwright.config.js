// The smoke test: every flow, at a phone's size and a desktop's, against the app served as the hosts serve it
// (tools/serve.py: byte ranges for the tiles, nothing cached). Run here, before a push (tools/hooks/pre-push); not on GitHub. Live data is the real feed's, so the checks are the
// ones that hold at any hour: each screen comes up, nothing says 'Something went wrong', nothing throws.
const { defineConfig, devices } = require('@playwright/test');
const PORT = 8795;   // not the preview's 8794

module.exports = defineConfig({
  testDir: '.',
  timeout: 120_000,   // a map test's own waits (the map settled, a bus placed by the feed) come to forty seconds before it does anything; a minute was up on a busy machine
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,   // two browsers with a map each is what a laptop takes in its stride; four, with anything else running, timed out
  retries: 1,   // the live feed and the relay now and then miss a beat; twice is a failure
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    serviceWorkers: 'block',   // the code on disk, never a cached release
    timezoneId: 'America/Denver',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `python3 ../serve.py ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    stdout: 'ignore',   // the server's log of every request, not wanted in a push's output
    timeout: 30_000,
  },
});
