/** Request context every service receives. Built only by `requireUser()` — never from client input. */
export interface Ctx {
  userId: string;
  tz: string;
  baseCurrency: string;
}
