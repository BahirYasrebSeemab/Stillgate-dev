// Every piece of text the visitors see, in one place (Russian/Tajik translations go here later).
export const t = {
  locked: {
    title: "Welcome to American Space Dushanbe",
    askDesk: "Please ask the registration desk to unlock this computer.",
    serviceDown: "Service not running",
  },
  launcher: {
    apps: "Programs",
    sites: "Websites",
    timeLeft: "Time left",
    warning: "Less than 5 minutes left. Please save your work.",
    empty: "No programs or websites are available.",
    failed: "This could not be opened. Please ask the registration desk.",
  },
  maintenance: {
    title: "Maintenance mode",
    detail: "Windows is restarting with the normal desktop…",
  },
  password: {
    title: "Maintenance",
    label: "Password",
    submit: "Unlock maintenance",
    cancel: "Cancel",
    wrong: "Wrong password.",
    lockedOut: (sec: number) => `Too many attempts. Try again in ${sec} seconds.`,
    noPassword: "No restore password is set on this PC yet. Use the administrator account.",
    unavailable: "The service is not running. Use the administrator account.",
    restoring: "Correct. The computer restarts now…",
  },
} as const;
