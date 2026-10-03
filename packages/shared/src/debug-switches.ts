// Command-line switches that would open a debugger or remote control into an Electron app.
// The packaged kiosk shell and manager refuse to start with any of them (together with the
// Electron "fuses" set in electron-builder.yml). Pure function, unit-tested.
const DEBUG_SWITCHES = [
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "--remote-debugging-address",
  "--inspect",
  "--inspect-brk",
  "--inspect-port",
  "--js-flags",
  "--remote-allow-origins",
];

export function hasDebugSwitch(argv: readonly string[]): boolean {
  return argv.some((arg) => {
    const name = arg.toLowerCase().split("=")[0] ?? "";
    return DEBUG_SWITCHES.some((blocked) => name === blocked || name === blocked.replace("--", "-"));
  });
}
