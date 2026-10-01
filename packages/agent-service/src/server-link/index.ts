// Public entry for other packages' tests (the manager's end-to-end test uses the real agent link)
export { ServerLink, type ServerCommand, type StateReport } from "./client";
export { pairWithServer } from "./pair";
